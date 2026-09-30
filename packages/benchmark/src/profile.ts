import type { CpuProfile, ProfileRow } from './types.ts'

export const summarizeProfile = (profile: CpuProfile): ProfileRow[] => {
  if (!Array.isArray(profile.nodes) || !Array.isArray(profile.samples) || !Array.isArray(profile.timeDeltas) || profile.samples.length !== profile.timeDeltas.length) {
    throw new TypeError('Invalid Chromium CPU profile: expected nodes, samples, and matching timeDeltas')
  }
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  if (byId.size !== profile.nodes.length) throw new TypeError('Invalid Chromium CPU profile: duplicate node id')
  const parents = new Map<number, number>()
  for (const node of profile.nodes) {
    for (const child of node.children || []) {
      if (!byId.has(child) || parents.has(child)) throw new TypeError('Invalid Chromium CPU profile node tree')
      parents.set(child, node.id)
    }
  }
  const totals = new Map<string, { row: ProfileRow; selfUs: number; inclusiveUs: number; sampleCount: number }>()
  let totalUs = 0
  for (let index = 0; index < profile.samples.length; index++) {
    const node = byId.get(profile.samples[index]!)
    const delta = profile.timeDeltas[index]!
    if (!node || !Number.isFinite(delta) || delta < 0) throw new TypeError('Invalid Chromium CPU profile sample')
    totalUs += delta
    const { functionName, url, lineNumber = -1, columnNumber = -1 } = node.callFrame
    let current: number | undefined = node.id
    const ancestors = new Set<number>()
    while (current !== undefined) {
      if (ancestors.has(current)) throw new TypeError('Invalid Chromium CPU profile node tree: cycle')
      ancestors.add(current)
      const frame = byId.get(current)
      if (!frame) throw new TypeError('Invalid Chromium CPU profile node tree')
      const location = frame.callFrame
      const ancestorKey = `${location.url}\0${location.functionName}\0${location.lineNumber ?? -1}\0${location.columnNumber ?? -1}`
      let entry = totals.get(ancestorKey)
      if (!entry) {
        entry = {
          row: {
            functionName: location.functionName, url: location.url,
            lineNumber: location.lineNumber ?? -1, columnNumber: location.columnNumber ?? -1,
            selfTimeMs: 0, inclusiveTimeMs: 0, selfPercent: 0, inclusivePercent: 0, sampleCount: 0,
          },
          selfUs: 0, inclusiveUs: 0, sampleCount: 0,
        }
        totals.set(ancestorKey, entry)
      }
      entry.inclusiveUs += delta
      if (current === node.id) {
        entry.selfUs += delta
        entry.sampleCount++
      }
      current = parents.get(current)
    }
  }
  return [...totals.values()].map(({ row, selfUs, inclusiveUs, sampleCount }) => ({
    ...row,
    selfTimeMs: selfUs / 1000,
    inclusiveTimeMs: inclusiveUs / 1000,
    selfPercent: totalUs ? selfUs / totalUs * 100 : 0,
    inclusivePercent: totalUs ? inclusiveUs / totalUs * 100 : 0,
    sampleCount,
  })).sort((a, b) => b.selfTimeMs - a.selfTimeMs)
}
