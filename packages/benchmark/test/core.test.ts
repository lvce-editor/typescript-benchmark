import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregate } from '../src/aggregate.ts'
import { summarizeProfile } from '../src/profile.ts'
import { parsePerformanceTrace } from '../src/readTrace.ts'
import { findTypeScriptWorker } from '../src/findTypeScriptWorker.ts'
import { waitFor } from '../src/waitFor.ts'

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

test('summarizes CPU profile sample self time by function and validates its payload', () => {
  const rows = summarizeProfile({
    nodes: [{ id: 1, callFrame: { functionName: 'parse', url: 'typescript.js' } }],
    samples: [1, 1],
    timeDeltas: [1000, 2500],
  })
  assert.equal(rows[0]?.selfTimeMs, 3.5)
  assert.throws(() => summarizeProfile({ nodes: [], samples: [1], timeDeltas: [] }), /Invalid Chromium CPU profile/)
})

test('parses a nested performance trace and rejects non-trace editor contents', () => {
  const contents = `typescript-performance-trace.json\n{\n  "error": null,\n  "file": { "uri": "file:///workspace/aboutWorkerMain.ts" },\n  "fresh": true,\n  "schemaVersion": 1,\n  "totalDurationMs": 42\n}`
  assert.equal(parsePerformanceTrace(contents)?.file.uri, 'file:///workspace/aboutWorkerMain.ts')
  assert.equal(parsePerformanceTrace('loading editor'), undefined)
})

test('selects only the TypeScript language worker target', () => {
  const targets = [
    { targetId: 'renderer', type: 'page', url: 'file:///lvce/index.html' },
    { targetId: 'other-worker', type: 'worker', url: 'file:///extensions/eslintWorkerMain.js' },
    { targetId: 'typescript', type: 'worker', url: 'file:///extensions/typescriptWorkerMain.js?v=1' },
  ]
  assert.equal(findTypeScriptWorker(targets)?.targetId, 'typescript')
  assert.equal(findTypeScriptWorker(targets.slice(0, 2)), undefined)
})
