import type { CpuProfile, ProfileRow } from './types.ts'

export const summarizeProfile = (profile: CpuProfile): ProfileRow[] => {
  if (!Array.isArray(profile.nodes) || !Array.isArray(profile.samples) || !Array.isArray(profile.timeDeltas) || profile.samples.length !== profile.timeDeltas.length) {
    throw new TypeError('Invalid Chromium CPU profile: expected nodes, samples, and matching timeDeltas')
  }
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  const totals = new Map<string, ProfileRow>()
  for (let index = 0; index < profile.samples.length; index++) {
    const node = byId.get(profile.samples[index]!)
    const delta = profile.timeDeltas[index]!
    if (!node || !Number.isFinite(delta) || delta < 0) throw new TypeError('Invalid Chromium CPU profile sample')
    const { functionName, url } = node.callFrame
    const key = `${url}\0${functionName}`
    const previous = totals.get(key)
    totals.set(key, { functionName, url, selfTimeMs: (previous?.selfTimeMs || 0) + delta / 1000 })
  }
  return [...totals.values()].sort((a, b) => b.selfTimeMs - a.selfTimeMs)
}
