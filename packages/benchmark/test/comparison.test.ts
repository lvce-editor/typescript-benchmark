import { test } from 'node:test'
import assert from 'node:assert/strict'
import { summarizeFilesystemTrace } from '../src/filesystemTrace.ts'
import { renderComparison } from '../../report/src/comparison.ts'

test('counts descendant reads once per path, repeated operations, failed stats and interval boundaries', () => {
  const trace = [
    '10 100.000000 read(3</before>, "a", 1) = 1',
    '10 101.000000 read(3</project/a.ts>, "abc", 3) = 3',
    '11 101.100000 pread64(4</project/a.ts>, "abc", 3, 0) = 3',
    '11 101.200000 read(4</project/b.ts>, "", 9) = 0',
    '11 101.300000 read(5<pipe:[123]>, "x", 1) = 1',
    '11 101.400000 statx(AT_FDCWD, "/missing", 0, STATX_ALL, 0) = -1 ENOENT (No such file)',
    '11 101.500000 fstat(3</project/a.ts>, {}) = 0',
    '12 101.600000 read(3</project/b.ts>,  <unfinished ...>',
    '12 101.800000 <... read resumed>"b", 1) = 1',
    '12 101.900000 read(3</project/c.ts>,  <unfinished ...>',
    '12 102.100000 <... read resumed>"c", 1) = 1',
    '10 102.200000 read(3</after>, "a", 1) = 1',
  ].join('\n')
  assert.deepEqual(summarizeFilesystemTrace(trace, 101, 102), {
    filesRead: 2, readCalls: 3, readBytes: 7, statCalls: 2, failedStatCalls: 1, paths: ['/project/a.ts', '/project/b.ts'],
  })
})

test('empty or incomplete trace is not a zero-valued success', () => {
  assert.throws(() => summarizeFilesystemTrace('', 1, 2), /No filesystem/)
  assert.throws(() => summarizeFilesystemTrace('10 1.500000 <... read resumed>"x", 1) = 1', 1, 2), /without entry/)
})

test('comparison report separates traced trials from timing and exposes failed/missing readings', () => {
  const html = renderComparison({ metadata: { version: '<script>' }, trials: [
    { editor: 'lvce', iteration: 1, mode: 'timing', success: true, readyMs: 10 },
    { editor: 'lvce', iteration: 2, mode: 'timing', success: true, readyMs: 20 },
    { editor: 'lvce', iteration: 1, mode: 'filesystem', success: true, readyMs: 99999, filesystem: { filesRead: 12, readCalls: 30, statCalls: 0 } },
    { editor: 'vscode', iteration: 1, mode: 'timing', success: false, readyMs: null, error: '<timeout>' },
  ] })
  assert.match(html, /15\.0 ms/)
  assert.match(html, /12\.0 paths/)
  assert.match(html, /0\.0 calls/)
  assert.match(html, /unavailable/)
  assert.doesNotMatch(html, /99999/)
  assert.match(html, /&lt;timeout&gt;/)
  assert.match(html, /&lt;script&gt;/)
})
