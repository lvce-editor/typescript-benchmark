import type { Trial } from './types.ts'

export interface Summary {
  readonly trials: number
  readonly successfulTrials: number
  readonly readyMedianMs: number | null
  readonly heapMedianBytes: number | null
  readonly failures: readonly string[]
}

const median = (values: number[]): number | null => {
  if (!values.length) return null
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2
}

export const aggregate = (trials: readonly Trial[]): Summary => ({
  trials: trials.length,
  successfulTrials: trials.filter((trial) => trial.success).length,
  readyMedianMs: median(trials.flatMap((trial) => (trial.success && trial.readyMs !== null ? [trial.readyMs] : []))),
  heapMedianBytes: median(trials.flatMap((trial) => (trial.success && trial.heapUsedBytes !== null ? [trial.heapUsedBytes] : []))),
  failures: trials.flatMap((trial) => (trial.success ? [] : [`Trial ${trial.iteration}: ${trial.error || 'unknown failure'}`])),
})
