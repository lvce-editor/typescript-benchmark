import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregate } from '../src/aggregate.ts'
import { normalizeProfileDeltas, summarizeProfile } from '../src/profile.ts'
import { parsePerformanceTrace } from '../src/readTrace.ts'
import { findTypeScriptWorker } from '../src/findTypeScriptWorker.ts'
import { TargetSession } from '../src/targetSession.ts'
import { waitFor } from '../src/waitFor.ts'
import { getEditorArgs } from '../src/editorArgs.ts'
import { formatFileSize, sortLoadedFiles } from '../../report/src/loadedFiles.ts'

test('aggregates successful trial medians and leaves failures visible', () => {
  const result = aggregate([
    { iteration: 1, success: true, readyMs: 10, heapUsedBytes: 100, processMemoryBytes: null },
    { iteration: 2, success: false, readyMs: null, heapUsedBytes: null, processMemoryBytes: null, error: 'worker timeout' },
    { iteration: 3, success: true, readyMs: 20, heapUsedBytes: 200, processMemoryBytes: null },
  ])
  assert.equal(result.readyMedianMs, 15)
  assert.equal(result.heapMedianBytes, 150)
  assert.equal(result.successfulTrials, 2)
  assert.deepEqual(result.failures, ['Trial 2: worker timeout'])
})

test('waitFor rejects when its readiness condition never appears', async () => {
  await assert.rejects(waitFor(async () => undefined, 1, 1), /Timed out/)
})

test('summarizes self and inclusive CPU samples by source location', () => {
  const summary = summarizeProfile({
    nodes: [
      { id: 1, callFrame: { functionName: '(root)', url: '' }, children: [2, 4] },
      { id: 2, callFrame: { functionName: 'parse', url: 'typescript.js', lineNumber: 10, columnNumber: 3 }, children: [3] },
      { id: 3, callFrame: { functionName: 'tokenize', url: 'typescript.js', lineNumber: 20, columnNumber: 7 } },
      { id: 4, callFrame: { functionName: '(idle)', url: '' } },
    ],
    samples: [3, 2, 3, 4],
    timeDeltas: [1000, 2000, 3000, 1000000],
  })
  assert.equal(summary.sampleCount, 4)
  assert.equal(summary.activeSampleCount, 3)
  assert.equal(summary.idleSampleCount, 1)
  assert.equal(summary.activeMs, 6)
  assert.equal(summary.idleMs, 1000)
  assert.equal(summary.profileWindowMs, 1006)
  assert.equal(summary.rows.some((row) => row.functionName === '(idle)'), false)
  assert.deepEqual(summary.rows[0], {
    functionName: 'tokenize', url: 'typescript.js', lineNumber: 20, columnNumber: 7,
    selfTimeMs: 4, inclusiveTimeMs: 4, selfPercent: 4000 / 6000 * 100, inclusivePercent: 4000 / 6000 * 100, sampleCount: 2,
  })
  const parse = summary.rows.find((row) => row.functionName === 'parse')
  assert.equal(parse?.selfTimeMs, 2)
  assert.equal(parse?.inclusiveTimeMs, 6)
  assert.equal(parse?.selfPercent, 2000 / 6000 * 100)
  assert.equal(parse?.inclusivePercent, 100)
})

test('accepts an empty CPU profile and rejects malformed profile trees or samples', () => {
  assert.deepEqual(summarizeProfile({ nodes: [], samples: [], timeDeltas: [] }), {
    rows: [], sampleCount: 0, activeSampleCount: 0, idleSampleCount: 0, activeMs: 0, idleMs: 0, profileWindowMs: 0,
  })
  assert.throws(() => summarizeProfile({ nodes: [], samples: [1], timeDeltas: [] }), /Invalid Chromium CPU profile/)
  assert.throws(() => summarizeProfile({
    nodes: [{ id: 1, callFrame: { functionName: 'a', url: '' }, children: [2] }], samples: [], timeDeltas: [],
  }), /Invalid Chromium CPU profile node tree/)
  assert.throws(() => summarizeProfile({
    nodes: [{ id: 1, callFrame: { functionName: 'a', url: '' } }], samples: [2], timeDeltas: [1000],
  }), /Invalid Chromium CPU profile sample/)
})

test('clamps negative Chromium sample intervals for interactive profiles and reports the adjustment', () => {
  const raw = {
    nodes: [{ id: 1, callFrame: { functionName: 'work', url: 'worker.js' } }],
    samples: [1, 1, 1], timeDeltas: [1000, -4, 2000],
  }
  const normalized = normalizeProfileDeltas(raw)
  assert.deepEqual(raw.timeDeltas, [1000, -4, 2000])
  assert.deepEqual(normalized.profile.timeDeltas, [1000, 0, 2000])
  assert.equal(normalized.adjustedSampleCount, 1)
  assert.equal(normalized.excludedDeltaUs, 4)
  assert.equal(summarizeProfile(normalized.profile).profileWindowMs, 3)
})

test('parses a nested performance trace and rejects non-trace editor contents', () => {
  const contents = `typescript-performance-trace.json\n{\n  "error": null,\n  "file": { "uri": "file:///workspace/aboutWorkerMain.ts" },\n  "fresh": true,\n  "schemaVersion": 1,\n  "totalDurationMs": 42\n}`
  assert.equal(parsePerformanceTrace(contents)?.file.uri, 'file:///workspace/aboutWorkerMain.ts')
  assert.equal(parsePerformanceTrace('loading editor'), undefined)
})

test('selects only the TypeScript language worker target', () => {
  const targets = [
    { targetId: 'renderer', type: 'page', url: 'file:///lvce/index.html', title: 'LVCE' },
    { targetId: 'eslint', type: 'worker', url: 'file:///extensions/extensionHostSubWorkerMain.js', title: '[worker-17] ESLint Worker' },
    { targetId: 'typescript', type: 'worker', url: 'file:///extensions/extensionHostSubWorkerMain.js', title: '[worker-19] TypeScript Worker' },
  ]
  assert.equal(findTypeScriptWorker(targets)?.targetId, 'typescript')
  assert.equal(findTypeScriptWorker(targets.slice(0, 2)), undefined)
})

test('CDP target session helper loads under Node type stripping', () => {
  assert.equal(typeof TargetSession, 'function')
})

test('launches LVCE in wait mode so shutdown reaches the Electron process', () => {
  assert.deepEqual(getEditorArgs(9222, '/tmp/lvce-profile', '/workspace/aboutWorkerMain.ts'), [
    '--wait', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9222', '--user-data-dir=/tmp/lvce-profile',
    '/workspace/aboutWorkerMain.ts',
  ])
})

test('deduplicates loaded files and sorts by descending UTF-8 byte size with stable path ties', () => {
  assert.deepEqual(sortLoadedFiles([
    { fileName: '/z.d.ts', sizeBytes: 4 },
    { fileName: '/b.d.ts', sizeBytes: 8 },
    { fileName: '/a.d.ts', sizeBytes: 8 },
    { fileName: '/z.d.ts', sizeBytes: 4 },
  ]), [
    { fileName: '/a.d.ts', sizeBytes: 8 },
    { fileName: '/b.d.ts', sizeBytes: 8 },
    { fileName: '/z.d.ts', sizeBytes: 4 },
  ])
  assert.deepEqual(sortLoadedFiles([]), [])
  assert.equal(formatFileSize(0), '0 B')
  assert.equal(formatFileSize(1536), '1.5 KiB (1536 B)')
})
