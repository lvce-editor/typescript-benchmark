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
  rows: [], trialCount: 1, totalSampleCount: 0, sampleCount: 0, idleSampleCount: 0,
  sampledCpuMs: 0, idleTimeMs: 0, profileWindowMs: 0, warmRequests: 10,
  downloads: ['cpu-profile-1.json'],
})
assert.match(pages.index, /unavailable/)
assert.match(pages.index, /&lt;timeout&gt;/)
assert.match(pages.index, /breakdown\.html/)
assert.match(pages.breakdown, /No active CPU samples were collected/)
assert.match(pages.breakdown, /10 sequential warm calls per trial/)
assert.match(pages.breakdown, /Raw profiles/)
assert.match(pages.breakdown, /cpu-profiles\/cpu-profile-1\.json/)
assert.match(pages.breakdown, /speedscope\/index\.html#profileURL=\.\.%2Fcpu-profiles%2Fcpu-profile-1\.json&amp;title=Trial%201%20warm%20TypeScript%20worker%20CPU%20profile/)
assert.match(pages.breakdown, /Open interactive profile for trial 1/)
assert.match(pages.breakdown, /V8 \(idle\) samples are excluded/)
const populated = renderPages({
  metadata: {
    node: 'v26.0.0', editor: { tag: 'v0.118.23', asset: 'editor.deb', sha256: 'abc123' },
    fixture: { repository: 'about-view', commit: '1234567890', file: 'aboutWorkerMain.ts' },
    readyBoundary: 'cold readiness', memoryBoundary: 'worker heap',
  },
  trials: [{ iteration: 1, success: true, readyMs: 10, heapUsedBytes: 100, processMemoryBytes: null,
    startupPhases: { launchToCdp: 1, pageReady: 2, workerDiscovery: 1, workerProtocol: 1, fixtureRead: 1, coldDiagnostic: 4 },
    coldTracePath: 'cold-trace-1.json', coldTrace: {
    file: { uri: 'file:///workspace/main.ts' }, fresh: true, schemaVersion: 1, totalDurationMs: 3,
    languageService: { cache: 'created' },
    stages: { semanticDiagnostics: { durationMs: 3 } },
    syncRpc: { callCount: 3, durationMs: 2, methods: { 'SyncApi.readFileSync': { callCount: 2, durationMs: 1.5 } } },
    loadedFiles: [
      { fileName: '/workspace/<main>.ts', sizeBytes: 2048 },
      { fileName: '/typescript/lib.d.ts', sizeBytes: 4096 },
      { fileName: '/typescript/lib.d.ts', sizeBytes: 4096 },
    ],
  }, featureTrace: {
    file: { uri: 'file:///workspace/main.ts' }, fresh: true, schemaVersion: 1, totalDurationMs: 1,
    loadedFiles: [
      { fileName: '/workspace/<main>.ts', sizeBytes: 2048 },
      { fileName: '/typescript/lib.d.ts', sizeBytes: 4096 },
      { fileName: '/typescript/lib.d.ts', sizeBytes: 4096 },
    ],
  } }],
}, {
  rows: [{
    functionName: 'parse', url: 'typescript.js', lineNumber: 3, columnNumber: 0,
    selfTimeMs: 4, inclusiveTimeMs: 8, selfPercent: 40, inclusivePercent: 80, sampleCount: 2, trialCount: 1,
  }],
  trialCount: 1, totalSampleCount: 5, sampleCount: 4, idleSampleCount: 1,
  sampledCpuMs: 10, idleTimeMs: 2, profileWindowMs: 12, warmRequests: 10, downloads: [],
})
assert.match(populated.breakdown, /Top sampled active worker CPU self time/)
assert.match(populated.breakdown, /Highest sampled active self-time contributor: parse/)
assert.match(populated.breakdown, /4 active samples represent 10\.00 ms of sampled active time and 1 idle samples span 2\.00 ms/)
assert.match(populated.breakdown, /4\.00 ms \(40\.0%\)/)
assert.match(populated.breakdown, /8\.00 ms \(80\.0%\)/)
assert.match(populated.breakdown, /TypeScript language-service files · 2 distinct files/)
assert.match(populated.index, /Cold startup phases · median sequential time/)
assert.match(populated.index, /Remaining within readiness interval/)
assert.match(populated.breakdown, /Cold diagnostic stages/)
assert.match(populated.breakdown, /First diagnostic pass · median internal duration/)
assert.match(populated.breakdown, /cache state: created/)
assert.match(populated.breakdown, /Cold synchronous RPC wall time/)
assert.match(populated.breakdown, /Cold synchronous RPC calls/)
assert.match(populated.breakdown, /RPC duration includes transport and waiting/)
assert.match(populated.breakdown, /cold-trace-1\.json/)
assert.ok(populated.breakdown.indexOf('/typescript/lib.d.ts') < populated.breakdown.indexOf('/workspace/&lt;main&gt;.ts'))
assert.match(populated.breakdown, /4\.0 KiB \(4096 B\)/)
assert.match(populated.breakdown, /style="width:100%"/)
const emptyFiles = renderPages({
  metadata: {
    node: 'v26.0.0', editor: { tag: 'v0.118.23', asset: 'editor.deb', sha256: 'abc123' },
    fixture: { repository: 'about-view', commit: '1234567890', file: 'aboutWorkerMain.ts' },
    readyBoundary: 'cold readiness', memoryBoundary: 'worker heap',
  },
  trials: [{ iteration: 1, success: true, readyMs: 10, heapUsedBytes: 100, processMemoryBytes: null, coldTrace: {
    file: { uri: 'file:///workspace/main.ts' }, fresh: true, schemaVersion: 1, totalDurationMs: 1, loadedFiles: [],
  } }],
}, {
  rows: [], trialCount: 1, totalSampleCount: 0, sampleCount: 0, idleSampleCount: 0,
  sampledCpuMs: 0, idleTimeMs: 0, profileWindowMs: 0, warmRequests: 10, downloads: [],
})
assert.match(emptyFiles.breakdown, /0 distinct files/)
assert.match(emptyFiles.breakdown, /No files were loaded into the TypeScript compiler program/)
assert.match(emptyFiles.index, /Remaining within readiness interval[\s\S]*unavailable/)
assert.match(emptyFiles.breakdown, /No interactive CPU profiles are available/)
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
