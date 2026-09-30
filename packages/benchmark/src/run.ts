import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { chromium, type Browser, type CDPSession } from 'playwright'
import { aggregate } from './aggregate.ts'
import { summarizeProfile } from './profile.ts'
import { TargetSession } from './targetSession.ts'
import { requestPerformanceTrace } from './readTrace.ts'
import { findTypeScriptWorker } from './findTypeScriptWorker.ts'
import type { CpuProfile, TargetInfo, Trial } from './types.ts'
import { waitFor } from './waitFor.ts'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const outputDir = resolve(process.env.BENCHMARK_OUTPUT || join(rootDir, 'results'))
const setup = JSON.parse(await readFile(join(rootDir, '.tmp/setup.json'), 'utf8')) as {
  editor: { tag: string; asset: string; sha256: string }
  extension: { repository: string; release: string }
  fixture: { repository: string; commit: string; file: string }
}
const args = process.argv.slice(2)
const getOption = (name: string, fallback: string): string => {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1] || fallback
}
const iterations = Math.max(1, Math.min(10, Number(getOption('--iterations', '3')) || 3))
const timeoutMs = Math.max(10000, Number(getOption('--timeout-ms', '90000')) || 90000)
const cacheDir = resolve(process.env.TYPESCRIPT_BENCHMARK_CACHE || join(rootDir, '.tmp/cache'))
const fixtureWorkspace = join(cacheDir, 'about-view')
const fixtureFile = join(fixtureWorkspace, setup.fixture.file)
const editorBinary = process.env.LVCE_EDITOR_BIN || 'lvce-editor'
const trials: Trial[] = []

const availablePort = async (): Promise<number> => {
  const server = createServer()
  await new Promise<void>((resolve, reject) => server.listen(0, '127.0.0.1', () => resolve()).once('error', reject))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to reserve a local debugging port')
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
  return address.port
}

const connect = async (port: number): Promise<Browser> => {
  const deadline = Date.now() + timeoutMs
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 2000 })
    } catch (error) {
      lastError = error
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }
  throw new Error(`LVCE Editor did not expose Chrome DevTools Protocol: ${lastError}`)
}

const runTrial = async (iteration: number): Promise<Trial> => {
  const port = await availablePort()
  const profile = join(rootDir, '.tmp/profiles', `trial-${iteration}`)
  await rm(profile, { recursive: true, force: true })
  await mkdir(profile, { recursive: true })
  const appProcess = spawn(editorBinary, [
    '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${join(profile, 'user-data')}`,
    fixtureFile,
  ], {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(profile, 'config'),
      XDG_DATA_HOME: join(profile, 'data'),
      XDG_CACHE_HOME: join(profile, 'cache'),
      XDG_STATE_HOME: join(profile, 'state'),
    },
  })
  const launchError = new Promise<never>((_resolve, reject) => appProcess.once('error', reject))
  const launchedAt = performance.now()
  let browser: Browser | undefined
  let root: CDPSession | undefined
  let worker: TargetSession | undefined
  let profileStarted = false
  try {
    browser = await Promise.race([connect(port), launchError])
    const page = await waitFor(async () => browser!.contexts().flatMap((context) => context.pages()).find((item) => item.url() !== 'about:blank'), timeoutMs)
    root = await browser.newBrowserCDPSession()
    await root.send('Target.setDiscoverTargets', { discover: true })
    const target = await waitFor(async () => {
      const { targetInfos } = await root!.send('Target.getTargets') as { targetInfos: TargetInfo[] }
      return findTypeScriptWorker(targetInfos)
    }, timeoutMs)
    const { sessionId } = await root.send('Target.attachToTarget', { targetId: target.targetId, flatten: false })
    worker = new TargetSession(root, sessionId)
    await worker.send('Runtime.enable')
    const ping = await worker.send<{ result: { value: number } }>('Runtime.evaluate', { expression: '6 * 7', returnByValue: true })
    if (ping.result.value !== 42) throw new Error('TypeScript worker did not return the expected protocol response')
    await worker.send('Profiler.enable')
    await worker.send('Profiler.start')
    profileStarted = true
    const featureTrace = await requestPerformanceTrace(page, timeoutMs, setup.fixture.file)
    const readyMs = performance.now() - launchedAt
    const featureTracePath = join(outputDir, `feature-trace-${iteration}.json`)
    await writeFile(featureTracePath, `${JSON.stringify(featureTrace, null, 2)}\n`)

    const cpu = await worker.send<{ profile: CpuProfile }>('Profiler.stop')
    profileStarted = false
    const profilePath = join(outputDir, `cpu-profile-${iteration}.json`)
    const profileSummaryPath = join(outputDir, `cpu-profile-${iteration}-summary.json`)
    await writeFile(profilePath, `${JSON.stringify(cpu.profile, null, 2)}\n`)
    await writeFile(profileSummaryPath, `${JSON.stringify(summarizeProfile(cpu.profile), null, 2)}\n`)
    const memory = await worker.send<{ usedSize: number; totalSize: number }>('Runtime.getHeapUsage')
    if (!Number.isFinite(memory.usedSize) || memory.usedSize <= 0) throw new Error(`Invalid TypeScript worker heap reading: ${memory.usedSize}`)
    return {
      iteration, success: true, readyMs, heapUsedBytes: memory.usedSize, processMemoryBytes: null,
      workerUrl: target.url, profilePath: profilePath.replace(`${rootDir}/`, ''),
      featureTracePath: featureTracePath.replace(`${rootDir}/`, ''), featureTrace,
    }
  } catch (error) {
    return {
      iteration, success: false, readyMs: null, heapUsedBytes: null, processMemoryBytes: null,
      error: error instanceof Error ? error.stack || error.message : String(error),
    }
  } finally {
    if (profileStarted && worker) await worker.send('Profiler.stop').catch(() => undefined)
    await worker?.close()
    await root?.detach().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    if (appProcess.pid && appProcess.exitCode === null && appProcess.signalCode === null) {
      try { process.kill(-appProcess.pid, 'SIGTERM') } catch { /* already exited */ }
      await Promise.race([
        new Promise<void>((resolve) => appProcess.once('close', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ])
      if (appProcess.exitCode === null && appProcess.signalCode === null) {
        try { process.kill(-appProcess.pid, 'SIGKILL') } catch { /* already exited */ }
      }
    }
    await rm(profile, { recursive: true, force: true })
  }
}

await mkdir(outputDir, { recursive: true })
for (let iteration = 1; iteration <= iterations; iteration++) {
  const trial = await runTrial(iteration)
  trials.push(trial)
  console.log(JSON.stringify(trial))
  await writeFile(join(outputDir, 'trials.json'), `${JSON.stringify({
    schemaVersion: 1,
    metadata: {
      node: process.version, platform: process.platform, architecture: process.arch,
      editor: setup.editor, extension: setup.extension, fixture: setup.fixture,
      readyBoundary: 'typescript.showPerformanceTrace returned a fresh diagnostic trace for the pinned about-view TypeScript file; stopwatch ends after validating the document URI and absence of a diagnostic error',
      memoryBoundary: 'dedicated TypeScript worker V8 usedSize bytes after CPU profile collection; excludes native/external process memory',
      coldTrials: true,
    },
    trials,
  }, null, 2)}\n`)
}
await writeFile(join(outputDir, 'summary.json'), `${JSON.stringify(aggregate(trials), null, 2)}\n`)
if (trials.some((trial) => !trial.success)) process.exitCode = 1
