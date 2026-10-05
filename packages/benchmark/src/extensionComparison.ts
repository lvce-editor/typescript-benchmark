import { strict as assert } from 'node:assert'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { execFileSync, spawnSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Trial } from './types.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const [baselineArg, candidateArg, repeatsArg = '5'] = process.argv.slice(2)
if (!candidateArg) throw new Error('Usage: extensionComparison.ts <baseline checkout> <candidate checkout> [repeats]')
const repeats = Number(repeatsArg)
if (!Number.isInteger(repeats) || repeats < 3 || repeats > 10) throw new Error('Use 3 to 10 repetitions')
const output = join(root, 'results/extension-comparison')
await mkdir(output, { recursive: true })
const setup = JSON.parse(await readFile(join(root, '.tmp/setup.json'), 'utf8'))
const variants: Record<string, { setup: string; commit: string; lockSha256: string; treeSha256: string; typescript: string }> = {}
const hashTree = async (directory: string): Promise<string> => {
  const hash = createHash('sha256')
  const visit = async (relative: string): Promise<void> => {
    for (const entry of (await readdir(join(directory, relative), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      const name = join(relative, entry.name)
      if (entry.isDirectory()) await visit(name)
      else if (entry.isFile()) hash.update(name).update('\0').update(await readFile(join(directory, name))).update('\0')
      else throw new Error(`Unsupported extension artifact entry: ${name}`)
    }
  }
  await visit('')
  return hash.digest('hex')
}
for (const [name, arg] of [['baseline', baselineArg], ['candidate', candidateArg]]) {
  const checkout = resolve(arg), directory = join(checkout, '.tmp/dist')
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: checkout, encoding: 'utf8' }).trim()
  const lockSha256 = createHash('sha256').update(await readFile(join(checkout, 'package-lock.json'))).digest('hex')
  const manifest = JSON.parse(await readFile(join(directory, 'extension.json'), 'utf8'))
  const typescript = JSON.parse(await readFile(join(directory, 'typescript/package.json'), 'utf8')).version
  assert.equal(manifest.id, setup.extension.id)
  const treeSha256 = await hashTree(directory)
  const path = join(output, `${name}-setup.json`)
  await writeFile(path, JSON.stringify({ ...setup, extension: { ...setup.extension, directory, release: `source:${commit}`, sha256: treeSha256, typescript, commit, lockSha256 } }, null, 2))
  variants[name] = { setup: path, commit, lockSha256, treeSha256, typescript }
}
assert.equal(variants.baseline.lockSha256, variants.candidate.lockSha256, 'Dependency lockfiles differ')
assert.equal(variants.baseline.typescript, variants.candidate.typescript, 'Compiler versions differ')
const rows: { variant: string; iteration: number; trial: Trial }[] = []
let graph: string | undefined
for (let iteration = 0; iteration < repeats; iteration++) {
  for (const name of iteration % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
    const directory = join(output, `${name}-${iteration}`)
    const result = spawnSync(process.execPath, [join(root, 'packages/benchmark/src/run.ts'), '--iterations', '1'], {
      cwd: root, env: { ...process.env, BENCHMARK_SETUP: variants[name].setup, BENCHMARK_OUTPUT: directory, BENCHMARK_RETAINED_HEAP: '1' },
      encoding: 'utf8', timeout: 12 * 60_000, maxBuffer: 8 * 1024 * 1024,
    })
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'run.log'), result.stdout + result.stderr)
    if (result.error || result.signal || result.status !== 0) throw new Error(`${name} failed: ${result.error ?? result.signal ?? result.stderr}`)
    const trials = JSON.parse(await readFile(join(directory, 'trials.json'), 'utf8')).trials as Trial[]
    assert.equal(trials.length, 1)
    const trial = trials[0]
    assert.equal(trial.success, true)
    assert.equal(trial.coldTrace?.diagnostics?.count, 0)
    assert.equal(trial.warmRequests?.length, 10)
    assert.ok(Number.isFinite(trial.retainedHeapUsedBytes) && trial.retainedHeapUsedBytes! > 0)
    const identity = JSON.stringify(trial.coldTrace!.loadedFiles!.map(file => ({ name: file.fileName, bytes: file.sizeBytes })).sort((a,b) => a.name.localeCompare(b.name)))
    if (graph) assert.equal(identity, graph, 'Loaded filenames or source sizes differ')
    graph = identity
    rows.push({ variant: name, iteration, trial })
    await writeFile(join(output, 'repetitions.json'), JSON.stringify(rows, null, 2))
    console.log({ variant: name, iteration, readyMs: trial.readyMs, coldMs: trial.coldTrace?.totalDurationMs, calls: trial.coldTrace?.syncRpc?.callCount })
  }
}
const median = (values: number[]): number => {
  const sorted = values.toSorted((a,b) => a-b), mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid-1] + sorted[mid]) / 2
}
const summary = Object.fromEntries(Object.keys(variants).map(name => {
  const trials = rows.filter(row => row.variant === name).map(row => row.trial)
  return [name, {
    readyMs: median(trials.map(trial => trial.readyMs!)),
    coldMs: median(trials.map(trial => trial.coldTrace!.totalDurationMs)),
    coldRpcCalls: median(trials.map(trial => trial.coldTrace!.syncRpc!.callCount)),
    coldRpcMs: median(trials.map(trial => trial.coldTrace!.syncRpc!.durationMs)),
    warmWallMs: median(trials.map(trial => median(trial.warmRequests!.map(request => request.wallMs)))),
    warmMs: median(trials.map(trial => median(trial.warmRequests!.map(request => request.totalDurationMs)))),
    retainedHeapUsedBytes: median(trials.map(trial => trial.retainedHeapUsedBytes!)),
    heapUsedBytes: median(trials.map(trial => trial.heapUsedBytes!)),
  }]
}))
await writeFile(join(output, 'overview.json'), JSON.stringify({
  schemaVersion: 1, node: process.version, editor: setup.editor, fixture: setup.fixture, variants, repeats,
  allGraphsEqual: true, graphHash: createHash('sha256').update(graph!).digest('hex'), summary,
  note: 'Alternating fresh isolated Electron profiles on one runner. Cold trace and readiness unprofiled; ten unchanged-document warm requests unprofiled. Separate warm/cold CPU profiles per trial. Same source filenames/sizes, dependency lockfile and compiler version required. OS page cache retained. Heap is post-profile V8 usedSize, not RSS; a separate retainedHeapUsedBytes reading follows explicit GC after all timing/profile measurements. Source extension overrides the pinned release for both variants.',
}, null, 2))
console.log(summary)
