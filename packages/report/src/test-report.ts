import assert from 'node:assert/strict'
import { renderPages } from './render.ts'
import { aggregateProfiles } from './profiles.ts'

const pages = renderPages({
  metadata: {
    node: 'v26.0.0',
    editor: { tag: 'v0.118.23', asset: 'editor.deb', sha256: 'abc123' },
    extension: { repository: 'language-features-typescript', release: 'v5.24.0' },
    fixture: { repository: 'about-view', commit: '1234567890', file: 'packages/about-view/src/aboutWorkerMain.ts' },
    readyBoundary: 'worker target answered a CDP ping',
    memoryBoundary: 'worker V8 heap',
  },
  trials: [{ iteration: 1, success: false, readyMs: null, heapUsedBytes: null, processMemoryBytes: null, error: '<timeout>' }],
}, {
  rows: [], trialCount: 1, sampleCount: 0, sampledCpuMs: 0, warmRequests: 10,
  downloads: ['cpu-profile-1.json'],
})
assert.match(pages.index, /unavailable/)
assert.match(pages.index, /&lt;timeout&gt;/)
assert.match(pages.index, /breakdown\.html/)
assert.match(pages.breakdown, /No CPU samples were collected/)
assert.match(pages.breakdown, /10 sequential warm calls per trial/)
assert.match(pages.breakdown, /Raw profiles/)
assert.match(pages.breakdown, /cpu-profiles\/cpu-profile-1\.json/)
const populated = renderPages({
  metadata: {
    node: 'v26.0.0', editor: { tag: 'v0.118.23', asset: 'editor.deb', sha256: 'abc123' },
    fixture: { repository: 'about-view', commit: '1234567890', file: 'aboutWorkerMain.ts' },
    readyBoundary: 'cold readiness', memoryBoundary: 'worker heap',
  },
  trials: [{ iteration: 1, success: true, readyMs: 10, heapUsedBytes: 100, processMemoryBytes: null }],
}, {
  rows: [{
    functionName: 'parse', url: 'typescript.js', lineNumber: 3, columnNumber: 0,
    selfTimeMs: 4, inclusiveTimeMs: 8, selfPercent: 40, inclusivePercent: 80, sampleCount: 2, trialCount: 1,
  }],
  trialCount: 1, sampleCount: 5, sampledCpuMs: 10, warmRequests: 10, downloads: [],
})
assert.match(populated.breakdown, /Top sampled worker CPU self time/)
assert.match(populated.breakdown, /Highest sampled self-time contributor: parse/)
assert.match(populated.breakdown, /4\.00 ms \(40\.0%\)/)
assert.match(populated.breakdown, /8\.00 ms \(80\.0%\)/)
const aggregatedRows = aggregateProfiles([
  { rows: [{
    functionName: 'parse', url: 'typescript.js', lineNumber: 3, columnNumber: 0,
    selfTimeMs: 10, inclusiveTimeMs: 20, selfPercent: 50, inclusivePercent: 100, sampleCount: 4,
  }] },
  { rows: [{
    functionName: 'parse', url: 'typescript.js', lineNumber: 3, columnNumber: 0,
    selfTimeMs: 20, inclusiveTimeMs: 40, selfPercent: 25, inclusivePercent: 50, sampleCount: 8,
  }, {
    functionName: 'other', url: 'typescript.js', lineNumber: 9, columnNumber: 1,
    selfTimeMs: 5, inclusiveTimeMs: 5, selfPercent: 25, inclusivePercent: 25, sampleCount: 2,
  }] },
])
assert.deepEqual(aggregatedRows[0], {
  functionName: 'parse', url: 'typescript.js', lineNumber: 3, columnNumber: 0,
  selfTimeMs: 15, inclusiveTimeMs: 30, selfPercent: 37.5, inclusivePercent: 75, sampleCount: 6, trialCount: 2,
})
assert.deepEqual(aggregatedRows[1], {
  functionName: 'other', url: 'typescript.js', lineNumber: 9, columnNumber: 1,
  selfTimeMs: 2.5, inclusiveTimeMs: 2.5, selfPercent: 12.5, inclusivePercent: 12.5, sampleCount: 1, trialCount: 2,
})
console.log('Report rendering checks passed')
