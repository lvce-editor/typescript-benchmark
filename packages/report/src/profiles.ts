import type { ProfileRow } from '../../benchmark/src/types.ts'
import type { ProfileAggregateRow } from './render.ts'

export interface ProfileTrial {
  readonly rows: readonly ProfileRow[]
}

const median = (values: number[]): number => {
  if (values.length === 0) return 0
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2
}

const keyOf = (row: ProfileRow): string => `${row.url}\0${row.functionName}\0${row.lineNumber}\0${row.columnNumber}`

export const aggregateProfiles = (trials: readonly ProfileTrial[]): ProfileAggregateRow[] => {
  const byFunction = new Map<string, ProfileRow>()
  for (const trial of trials) {
    for (const row of trial.rows) byFunction.set(keyOf(row), row)
  }
  return [...byFunction.values()].map((identity) => {
    const key = keyOf(identity)
    const rows = trials.map((trial) => trial.rows.find((row) => keyOf(row) === key))
    return {
      functionName: identity.functionName,
      url: identity.url,
      lineNumber: identity.lineNumber,
      columnNumber: identity.columnNumber,
      selfTimeMs: median(rows.map((row) => row?.selfTimeMs || 0)),
      inclusiveTimeMs: median(rows.map((row) => row?.inclusiveTimeMs || 0)),
      selfPercent: median(rows.map((row) => row?.selfPercent || 0)),
      inclusivePercent: median(rows.map((row) => row?.inclusivePercent || 0)),
      sampleCount: median(rows.map((row) => row?.sampleCount || 0)),
      trialCount: trials.length,
    }
  }).sort((a, b) => b.selfTimeMs - a.selfTimeMs)
}
