import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawn } from 'node:child_process'
import { chromium, type Browser, type CDPSession } from 'playwright'
import { aggregate } from './aggregate.ts'
import { normalizeProfileDeltas, summarizeProfile } from './profile.ts'
import { TargetSession } from './targetSession.ts'
import { requestPerformanceTrace } from './readTrace.ts'
import { findTypeScriptWorker } from './findTypeScriptWorker.ts'
import { getEditorArgs } from './editorArgs.ts'
import type { CpuProfile, TargetInfo, Trial } from './types.ts'
import { waitFor } from './waitFor.ts'

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const outputDir = resolve(process.env.BENCHMARK_OUTPUT || join(rootDir, 'results'))
const setup = JSON.parse(await readFile(join(rootDir, '.tmp/setup.json'), 'utf8')) as {
  editor: { tag: string; asset: string; sha256: string; dataDirectoryName: string; binary: string }
  extension: { repository: string; release: string; sha256: string; id: string; directory: string; overridesBundled: boolean }
  fixture: { repository: string; commit: string; file: string }
}
const args = process.argv.slice(2)
const getOption = (name: string, fallback: string): string => {
  const index = args.indexOf(name)
  return index < 0 ? fallback : args[index + 1] || fallback
}
const iterations = Math.max(1, Math.min(10, Number(getOption('--iterations', '3')) || 3))
const timeoutMs = Math.max(10000, Number(getOption('--timeout-ms', '300000')) || 300000)
const cacheDir = resolve(process.env.TYPESCRIPT_BENCHMARK_CACHE || join(rootDir, '.tmp/cache'))
const fixtureWorkspace = join(cacheDir, 'about-view')
const fixtureFile = join(fixtureWorkspace, setup.fixture.file)
const editorBinary = process.env.LVCE_EDITOR_BIN || setup.editor.binary
const profileRequests = 10
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
  const dataHome = join(profile, 'data')
  const extensionInstallPath = join(dataHome, setup.editor.dataDirectoryName, 'extensions', setup.extension.id)
  await mkdir(dirname(extensionInstallPath), { recursive: true })
  await cp(setup.extension.directory, extensionInstallPath, { recursive: true })
  const launchedAt = performance.now()
  const appProcess = spawn(editorBinary, getEditorArgs(port, join(profile, 'user-data'), fixtureFile), {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(profile, 'config'),
      XDG_DATA_HOME: dataHome,
      XDG_CACHE_HOME: join(profile, 'cache'),
      XDG_STATE_HOME: join(profile, 'state'),
    },
  })
  const launchError = new Promise<never>((_resolve, reject) => appProcess.once('error', reject))
  let browser: Browser | undefined
  let root: CDPSession | undefined
  let worker: TargetSession | undefined
  let profileStarted = false
  try {
    browser = await Promise.race([connect(port), launchError])
    const cdpConnectedAt = performance.now()
    const page = await waitFor(async () => browser!.contexts().flatMap((context) => context.pages()).find((item) => item.url() !== 'about:blank'), timeoutMs)
    const pageReadyAt = performance.now()
    root = await browser.newBrowserCDPSession()
    await root.send('Target.setDiscoverTargets', { discover: true })
    const target = await waitFor(async () => {
      const { targetInfos } = await root!.send('Target.getTargets') as { targetInfos: TargetInfo[] }
      return findTypeScriptWorker(targetInfos)
    }, timeoutMs)
    const workerDiscoveredAt = performance.now()
    const { sessionId } = await root.send('Target.attachToTarget', { targetId: target.targetId, flatten: false })
    worker = new TargetSession(root, sessionId)
    await worker.send('Runtime.enable')
    const ping = await worker.send<{ result: { value: number } }>('Runtime.evaluate', { expression: '6 * 7', returnByValue: true })
    if (ping.result.value !== 42) throw new Error('TypeScript worker did not return the expected protocol response')
    const workerProtocolReadyAt = performance.now()
    const textDocument = {
      uri: pathToFileURL(fixtureFile).href,
      text: await readFile(fixtureFile, 'utf8'),
    }
    const fixtureReadAt = performance.now()
    const initialTrace = await requestPerformanceTrace(worker, timeoutMs, setup.fixture.file, textDocument, 'getFirstPerformanceTrace')
    if (initialTrace.languageService?.cache !== 'created') {
      throw new Error(`The first diagnostic trace was not captured during language-service creation: ${initialTrace.languageService?.cache || 'cache state unavailable'}`)
    }
    if (!initialTrace.loadedFiles?.length) throw new Error('The installed TypeScript extension did not report loaded files')
    const readyAt = performance.now()
    const readyMs = readyAt - launchedAt
    const coldTracePath = join(outputDir, `cold-trace-${iteration}.json`)
    await writeFile(coldTracePath, `${JSON.stringify(initialTrace, null, 2)}\n`)
    const startupPhases = {
      launchToCdp: cdpConnectedAt - launchedAt,
      pageReady: pageReadyAt - cdpConnectedAt,
      workerDiscovery: workerDiscoveredAt - pageReadyAt,
      workerProtocol: workerProtocolReadyAt - workerDiscoveredAt,
      fixtureRead: fixtureReadAt - workerProtocolReadyAt,
      coldDiagnostic: readyAt - fixtureReadAt,
    }
    await worker.send('Profiler.enable')
    await worker.send('Profiler.start')
    profileStarted = true
    let featureTrace = await requestPerformanceTrace(worker, timeoutMs, setup.fixture.file, textDocument)
    for (let request = 1; request < profileRequests; request++) {
      featureTrace = await requestPerformanceTrace(worker, timeoutMs, setup.fixture.file, textDocument)
    }
    featureTrace = { ...featureTrace, loadedFiles: initialTrace.loadedFiles }
    const featureTracePath = join(outputDir, `feature-trace-${iteration}.json`)
    await writeFile(featureTracePath, `${JSON.stringify(featureTrace, null, 2)}\n`)

    const cpu = await worker.send<{ profile: CpuProfile }>('Profiler.stop')
    profileStarted = false
    const profilePath = join(outputDir, `cpu-profile-${iteration}.json`)
    const profileSummaryPath = join(outputDir, `cpu-profile-${iteration}-summary.json`)
    await writeFile(profilePath, `${JSON.stringify(cpu.profile, null, 2)}\n`)
    const profileSummary = summarizeProfile(cpu.profile)
    await writeFile(profileSummaryPath, `${JSON.stringify(profileSummary.rows, null, 2)}\n`)
    const memory = await worker.send<{ usedSize: number; totalSize: number }>('Runtime.getHeapUsage')
    if (!Number.isFinite(memory.usedSize) || memory.usedSize <= 0) throw new Error(`Invalid TypeScript worker heap reading: ${memory.usedSize}`)
    return {
      iteration, success: true, readyMs, startupPhases, heapUsedBytes: memory.usedSize, processMemoryBytes: null,
      workerUrl: target.url, profilePath: profilePath.replace(`${rootDir}/`, ''),
      coldTracePath: `cold-trace-${iteration}.json`, coldTrace: initialTrace,
      featureTracePath: featureTracePath.replace(`${rootDir}/`, ''), featureTrace,
      profileRequests, profileSampleCount: profileSummary.sampleCount,
      profileActiveSampleCount: profileSummary.activeSampleCount,
      profileIdleSampleCount: profileSummary.idleSampleCount,
      profileActiveMs: profileSummary.activeMs,
      profileIdleMs: profileSummary.idleMs,
      profileWindowMs: profileSummary.profileWindowMs,
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

// Capture the first diagnostic in a separate fresh editor launch. Starting the
// profiler in the readiness trial would silently add profiler overhead to the
// published readiness measurement.
const captureColdProfile = async (iteration: number): Promise<Partial<Trial>> => {
  const port = await availablePort()
  const profile = join(rootDir, '.tmp/profiles', `trial-${iteration}-cold`)
  await rm(profile, { recursive: true, force: true })
  await mkdir(profile, { recursive: true })
  const dataHome = join(profile, 'data')
  const extensionInstallPath = join(dataHome, setup.editor.dataDirectoryName, 'extensions', setup.extension.id)
  await mkdir(dirname(extensionInstallPath), { recursive: true })
  await cp(setup.extension.directory, extensionInstallPath, { recursive: true })
  const appProcess = spawn(editorBinary, getEditorArgs(port, join(profile, 'user-data'), fixtureFile), {
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      XDG_CONFIG_HOME: join(profile, 'config'),
      XDG_DATA_HOME: dataHome,
      XDG_CACHE_HOME: join(profile, 'cache'),
      XDG_STATE_HOME: join(profile, 'state'),
    },
  })
  const launchError = new Promise<never>((_resolve, reject) => appProcess.once('error', reject))
  let browser: Browser | undefined
  let root: CDPSession | undefined
  let worker: TargetSession | undefined
  let profileStarted = false
  try {
    browser = await Promise.race([connect(port), launchError])
    await waitFor(async () => browser!.contexts().flatMap((context) => context.pages()).find((item) => item.url() !== 'about:blank'), timeoutMs)
    root = await browser.newBrowserCDPSession()
    await root.send('Target.setDiscoverTargets', { discover: true })
    const target = await waitFor(async () => {
      const { targetInfos } = await root!.send('Target.getTargets') as { targetInfos: TargetInfo[] }
      return findTypeScriptWorker(targetInfos)
    }, timeoutMs)
    const { sessionId } = await root.send('Target.attachToTarget', { targetId: target.targetId, flatten: false })
    worker = new TargetSession(root, sessionId)
    await worker.send('Runtime.enable')
    const textDocument = {
      uri: pathToFileURL(fixtureFile).href,
      text: await readFile(fixtureFile, 'utf8'),
    }
    await worker.send('Profiler.enable')
    await worker.send('Profiler.start')
    profileStarted = true
    const requestStartedAt = performance.now()
    const coldTrace = await requestPerformanceTrace(worker, timeoutMs, setup.fixture.file, textDocument, 'getFirstPerformanceTrace')
    const coldProfileWallMs = performance.now() - requestStartedAt
    if (coldTrace.languageService?.cache !== 'created') {
      throw new Error(`The cold profile trial did not capture language-service creation: ${coldTrace.languageService?.cache || 'cache state unavailable'}`)
    }
    const cpu = await worker.send<{ profile: CpuProfile }>('Profiler.stop')
    profileStarted = false
    const rawProfilePath = join(outputDir, `cold-cpu-profile-${iteration}-raw.json`)
    const profilePath = join(outputDir, `cold-cpu-profile-${iteration}.json`)
    const profileSummaryPath = join(outputDir, `cold-cpu-profile-${iteration}-summary.json`)
    await writeFile(rawProfilePath, `${JSON.stringify(cpu.profile, null, 2)}\n`)
    const normalized = normalizeProfileDeltas(cpu.profile)
    await writeFile(profilePath, `${JSON.stringify(normalized.profile, null, 2)}\n`)
    const profileSummary = summarizeProfile(normalized.profile)
    await writeFile(profileSummaryPath, `${JSON.stringify(profileSummary.rows, null, 2)}\n`)
    return {
      coldProfilePath: profilePath.replace(`${rootDir}/`, ''),
      coldProfileWallMs,
      coldProfileSampleCount: profileSummary.sampleCount,
      coldProfileActiveSampleCount: profileSummary.activeSampleCount,
      coldProfileIdleSampleCount: profileSummary.idleSampleCount,
      coldProfileActiveMs: profileSummary.activeMs,
      coldProfileIdleMs: profileSummary.idleMs,
      coldProfileWindowMs: profileSummary.profileWindowMs,
      coldProfileAdjustedSampleCount: normalized.adjustedSampleCount,
      coldProfileExcludedDeltaUs: normalized.excludedDeltaUs,
    }
  } catch (error) {
    return { coldProfileError: error instanceof Error ? error.stack || error.message : String(error) }
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
  const trial = { ...await runTrial(iteration), ...await captureColdProfile(iteration) }
  trials.push(trial)
  console.log(JSON.stringify(trial))
  await writeFile(join(outputDir, 'trials.json'), `${JSON.stringify({
    schemaVersion: 1,
    metadata: {
      node: process.version, platform: process.platform, architecture: process.arch,
      editor: setup.editor, extension: setup.extension, fixture: setup.fixture,
      readyBoundary: 'Diagnostic.getFirstPerformanceTrace returned the first cold diagnostic trace for the pinned about-view TypeScript file; stopwatch starts immediately before launching LVCE and ends after validating the document URI and absence of a diagnostic error',
      memoryBoundary: 'dedicated TypeScript worker V8 usedSize bytes after CPU profile collection; excludes native/external process memory',
      cpuProfileBoundary: `${profileRequests} sequential warm Diagnostic.getPerformanceTrace calls after cold readiness; CPU samples measure on-CPU time during those calls, not wall time`,
      coldCpuProfileBoundary: 'Separate fresh editor launch; CPU Profiler starts before the first Diagnostic.getFirstPerformanceTrace request and stops after its response. The unprofiled readiness trial remains unchanged.',
      coldTrials: true,
    },
    trials,
  }, null, 2)}\n`)
}
await writeFile(join(outputDir, 'summary.json'), `${JSON.stringify(aggregate(trials), null, 2)}\n`)
if (trials.some((trial) => !trial.success || !trial.coldProfilePath)) process.exitCode = 1
