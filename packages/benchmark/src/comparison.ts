import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { chromium, type Browser } from 'playwright'
import { verifyLvceDiagnostic } from './verifyLvceDiagnostic.ts'
import { summarizeFilesystemTrace } from './filesystemTrace.ts'

const setup = JSON.parse(await readFile('.tmp/setup.json', 'utf8'))
const comparison = JSON.parse(await readFile('.tmp/comparison-setup.json', 'utf8'))
const output = resolve(process.env.BENCHMARK_OUTPUT || 'results')
await mkdir(output, { recursive: true })
const iterations = Number(process.env.COMPARISON_ITERATIONS || 3)
if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10) throw new Error('COMPARISON_ITERATIONS must be 1–10')
if (process.env.COMPARISON_MODE && !['timing', 'filesystem'].includes(process.env.COMPARISON_MODE)) throw new Error('Invalid COMPARISON_MODE')
const timeout = Number(process.env.COMPARISON_TIMEOUT_MS || 300000)
if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 600000) throw new Error('COMPARISON_TIMEOUT_MS must be 1000–600000')
interface ComparisonTrial {
  editor: string
  iteration: number
  mode: string
  success: boolean
  readyMs: number | null
  filesystem?: ReturnType<typeof summarizeFilesystemTrace>
  error?: string
  interval?: { startSeconds: number; endSeconds: number }
}
const results: ComparisonTrial[] = []
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
const port = async () => {
  const server = createServer()
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject))
  const address = server.address() as { port: number }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}
for (let iteration = 1; iteration <= iterations; iteration++) {
  for (const editor of iteration % 2 ? ['lvce', 'vscode'] : ['vscode', 'lvce']) {
    for (const mode of process.env.COMPARISON_MODE ? [process.env.COMPARISON_MODE] : ['timing', 'filesystem']) {
      const id = `${editor}-${iteration}-${mode}`
      const profile = await mkdtemp(join(tmpdir(), 'ts-compare-'))
      const debugPort = await port()
      const userData = join(profile, 'user-data')
      if (editor === 'lvce') {
        await mkdir(join(profile, 'config/lvce'), { recursive: true })
        await writeFile(join(profile, 'config/lvce/settings.json'), JSON.stringify({ 'editor.diagnostics': true }))
        await cp(setup.extension.directory, join(profile, 'data/lvce/extensions', setup.extension.id), { recursive: true })
      } else {
        await mkdir(join(userData, 'User'), { recursive: true })
        await writeFile(join(userData, 'User/settings.json'), JSON.stringify({ 'security.workspace.trust.enabled': false, 'workbench.startupEditor': 'none', 'update.mode': 'none', 'telemetry.telemetryLevel': 'off', 'extensions.autoUpdate': false, 'editor.minimap.enabled': false }))
      }
      const binary = editor === 'lvce' ? setup.editor.binary : comparison.vscode.binary
      const args = ['--no-sandbox', '--disable-gpu', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`,
        ...(editor === 'vscode' ? ['--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', `--extensions-dir=${join(profile, 'extensions')}`] : []),
        comparison.fixture.workspace, comparison.fixture.file]
      let browser: Browser | undefined
      const tracePath = join(output, `${id}.strace`)
      const startedSeconds = Date.now() / 1000
      const started = performance.now()
      let endedSeconds = 0
      const command = mode === 'filesystem' ? 'strace' : binary
      const commandArgs = mode === 'filesystem' ? ['-f', '-qq', '-yy', '-ttt', '-s', '0', '-e',
        'trace=read,pread64,readv,preadv,preadv2,newfstatat,stat,lstat,fstat,statx', '-o', tracePath, binary, ...args] : args
      const child = spawn(command, commandArgs, { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
        XDG_CONFIG_HOME: join(profile, 'config'), XDG_DATA_HOME: join(profile, 'data'), XDG_CACHE_HOME: join(profile, 'cache'), XDG_STATE_HOME: join(profile, 'state') } })
      const closed = new Promise<void>((resolve) => { child.once('close', () => resolve()); child.once('error', () => resolve()) })
      let log = ''
      let launchError: Error | undefined
      child.on('error', (error) => { launchError = error })
      child.stdout.on('data', (chunk) => { log += chunk })
      child.stderr.on('data', (chunk) => { log += chunk })
      try {
        const deadline = Date.now() + timeout
        while (!browser && Date.now() < deadline) {
          if (launchError) throw launchError
          if (child.exitCode !== null) throw new Error(`Editor exited: ${child.exitCode}`)
          try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 1000 }) } catch { await delay(100) }
        }
        if (!browser) throw new Error('CDP connection timeout')
        let page = browser.contexts().flatMap((context) => context.pages())[0]
        while (!page && Date.now() < deadline) {
          await delay(100)
          page = browser.contexts().flatMap((context) => context.pages())[0]
        }
        if (!page) throw new Error('Editor page missing')
        const selector = editor === 'lvce' ? '.Diagnostic.DiagnosticError' : '.monaco-editor .squiggly-error'
        await page.locator(selector).first().waitFor({ state: 'visible', timeout: Math.max(1, deadline - Date.now()) })
        const readyMs = performance.now() - started
        endedSeconds = Date.now() / 1000
        if (editor === 'lvce') {
          const diagnostic = await verifyLvceDiagnostic(browser, comparison.fixture.file, comparison.fixture.expected)
          await writeFile(join(output, `${id}-diagnostic.json`), JSON.stringify(diagnostic, null, 2))
        } else {
          await page.locator(selector).first().hover({ force: true, timeout: 5000 })
          await page.getByText(comparison.fixture.expected, { exact: false }).first().waitFor({ state: 'visible', timeout: 10000 })
        }
        await page.screenshot({ path: join(output, `${id}.png`), timeout: 10000 })
        results.push({ editor, iteration, mode, success: true, readyMs: mode === 'timing' ? readyMs : null })
      } catch (error) {
        results.push({ editor, iteration, mode, success: false, readyMs: null, error: String(error) })
        const page = browser?.contexts().flatMap((context) => context.pages())[0]
        if (page) {
          await writeFile(join(output, `${id}-failure.html`), await page.content().catch(() => ''))
          await page.screenshot({ path: join(output, `${id}-failure.png`), timeout: 5000 }).catch(() => {})
        }
      } finally {
        await browser?.close().catch(() => {})
        if (child.pid) {
          try { process.kill(-child.pid, 'SIGTERM') } catch {}
          await delay(1000)
          try { process.kill(-child.pid, 'SIGKILL') } catch {}
          await Promise.race([closed, delay(5000)])
        }
        await writeFile(join(output, `${id}.log`), log)
        await rm(profile, { recursive: true, force: true })
      }
      const trial = results.at(-1)!
      if (trial.success && mode === 'filesystem') {
        try {
          trial.interval = { startSeconds: startedSeconds, endSeconds: endedSeconds }
          trial.filesystem = summarizeFilesystemTrace(await readFile(tracePath, 'utf8'), startedSeconds, endedSeconds)
        } catch (error) {
          trial.success = false
          trial.error = String(error)
        }
      }
      console.log({ ...trial, filesystem: trial.filesystem && { ...trial.filesystem, paths: `${trial.filesystem.paths.length} paths retained in comparison.json` } })
      await writeFile(join(output, 'comparison.json'), JSON.stringify({ schemaVersion: 1, metadata: { node: process.version, platform: process.platform, architecture: process.arch, cachePolicy: 'fresh editor profile; OS caches retained', ...comparison, lvce: setup.editor, extension: setup.extension }, trials: results }, null, 2))
    }
  }
}
if (results.some((trial) => !trial.success)) process.exitCode = 1
