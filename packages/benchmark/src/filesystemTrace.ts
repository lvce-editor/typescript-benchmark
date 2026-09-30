// strace -f -qq -yy -ttt: timestamps are syscall entry times. Resumed calls retain
// their original entry time so operations crossing readiness are excluded.
export const summarizeFilesystemTrace = (text: string, startSeconds: number, endSeconds: number) => {
  const pending = new Map<string, { time: number; call: string }>()
  const files = new Set<string>()
  let readCalls = 0
  let readBytes = 0
  let statCalls = 0
  let failedStatCalls = 0
  let observedCalls = 0
  for (const line of text.split('\n')) {
    const match = /^(\d+)\s+(\d+\.\d+)\s+(.*)$/.exec(line)
    if (!match) continue
    const [, pid, timestamp, body] = match
    let time = Number(timestamp)
    let call = body
    if (body.endsWith('<unfinished ...>')) {
      pending.set(pid, { time, call: body.slice(0, -16) })
      continue
    }
    if (body.startsWith('<... ')) {
      const earlier = pending.get(pid)
      pending.delete(pid)
      if (!earlier) throw new Error(`Resumed syscall without entry: ${line}`)
      call = earlier.call + body.replace(/^<\.\.\. \w+ resumed>/, '')
      time = earlier.time
    }
    // Both entry and completion must fall within the measurement window.
    if (time < startSeconds || Number(timestamp) > endSeconds) continue
    const result = /\)\s+=\s+(-?\d+)/.exec(call)
    if (!result) continue
    const value = Number(result[1])
    observedCalls++
    if (/^(?:stat|lstat|fstat|newfstatat|statx)\(/.test(call)) {
      statCalls++
      if (value < 0) failedStatCalls++
    }
    const read = /^(?:read|pread64|readv|preadv|preadv2)\(\d+<([^>]+)>/.exec(call)
    if (read && value > 0 && read[1].startsWith('/')) {
      files.add(read[1])
      readCalls++
      readBytes += value
    }
  }
  if (!observedCalls) throw new Error('No filesystem syscalls in the measured interval')
  return { filesRead: files.size, readCalls, readBytes, statCalls, failedStatCalls, paths: [...files].sort() }
}
