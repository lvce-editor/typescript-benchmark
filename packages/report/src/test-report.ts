import assert from 'node:assert/strict'
import { renderPages } from './render.ts'

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
}, [])
assert.match(pages.index, /unavailable/)
assert.match(pages.index, /&lt;timeout&gt;/)
assert.match(pages.index, /breakdown\.html/)
assert.match(pages.breakdown, /No CPU samples were collected/)
console.log('Report rendering checks passed')
