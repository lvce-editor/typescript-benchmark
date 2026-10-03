import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BenchmarkData } from './render.ts'
import { renderComparison, type ComparisonData } from './comparison.ts'
import { renderPages } from './render.ts'
import { aggregateProfiles } from './profiles.ts'
import type { ProfileRow } from '../../benchmark/src/types.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const output = resolve(process.env.PAGES_OUTPUT || join(root, '.tmp/pages'))
const data = JSON.parse(await readFile(join(root, 'results/trials.json'), 'utf8')) as BenchmarkData
const summaries = await readdir(join(root, 'results')).then((files) => files.filter((file) => /^cpu-profile-\d+-summary\.json$/.test(file)))
const coldSummaries = await readdir(join(root, 'results')).then((files) => files.filter((file) => /^cold-cpu-profile-\d+-summary\.json$/.test(file)))
const successfulTrials = new Map(data.trials.filter((trial) => trial.success).map((trial) => [trial.iteration, trial]))
const profileTrials = await Promise.all(summaries.map(async (file) => {
  const iteration = Number(file.match(/^cpu-profile-(\d+)-summary\.json$/)?.[1])
  if (!successfulTrials.has(iteration)) return undefined
  return {
    iteration,
    rows: JSON.parse(await readFile(join(root, 'results', file), 'utf8')) as ProfileRow[],
  }
}))
const profiles = aggregateProfiles(profileTrials.filter((trial): trial is NonNullable<typeof trial> => Boolean(trial)))
const coldProfileTrials = await Promise.all(coldSummaries.map(async (file) => {
  const iteration = Number(file.match(/^cold-cpu-profile-(\d+)-summary\.json$/)?.[1])
  if (!successfulTrials.has(iteration)) return undefined
  return {
    iteration,
    rows: JSON.parse(await readFile(join(root, 'results', file), 'utf8')) as ProfileRow[],
  }
}))
const coldProfiles = aggregateProfiles(coldProfileTrials.filter((trial): trial is NonNullable<typeof trial> => Boolean(trial)))
const successfulProfileTrials = [...successfulTrials.values()].filter((trial) => trial.profileSampleCount !== undefined)
const profileIterations = new Set(successfulProfileTrials.map((trial) => trial.iteration))
const rawProfiles = await readdir(join(root, 'results')).then((files) => files.filter((file) => {
  const iteration = Number(file.match(/^cpu-profile-(\d+)\.json$/)?.[1])
  return profileIterations.has(iteration)
}))
const coldSuccessfulIterations = new Set([...successfulTrials.values()].filter((trial) => trial.coldProfilePath).map((trial) => trial.iteration))
const coldRawProfiles = await readdir(join(root, 'results')).then((files) => files.filter((file) => {
  const iteration = Number(file.match(/^cold-cpu-profile-(\d+)\.json$/)?.[1])
  return coldSuccessfulIterations.has(iteration)
}))
const coldOriginalProfiles = await readdir(join(root, 'results')).then((files) => files.filter((file) => {
  const iteration = Number(file.match(/^cold-cpu-profile-(\d+)-raw\.json$/)?.[1])
  return coldSuccessfulIterations.has(iteration)
}))
const breakdown = {
  rows: profiles,
  trialCount: successfulProfileTrials.length,
  totalSampleCount: successfulProfileTrials.reduce((total, trial) => total + (trial.profileSampleCount || 0), 0),
  sampleCount: successfulProfileTrials.reduce((total, trial) => total + (trial.profileActiveSampleCount || 0), 0),
  idleSampleCount: successfulProfileTrials.reduce((total, trial) => total + (trial.profileIdleSampleCount || 0), 0),
  sampledCpuMs: successfulProfileTrials.reduce((total, trial) => total + (trial.profileActiveMs || 0), 0),
  idleTimeMs: successfulProfileTrials.reduce((total, trial) => total + (trial.profileIdleMs || 0), 0),
  profileWindowMs: successfulProfileTrials.reduce((total, trial) => total + (trial.profileWindowMs || 0), 0),
  warmRequests: successfulProfileTrials.length
    ? successfulProfileTrials.map((trial) => trial.profileRequests || 0).sort((a, b) => a - b)[Math.floor(successfulProfileTrials.length / 2)]!
    : 0,
  downloads: rawProfiles,
  coldRows: coldProfiles,
  coldDownloads: coldRawProfiles,
  coldRawDownloads: coldOriginalProfiles,
  coldTrialCount: coldSuccessfulIterations.size,
  coldSampleCount: [...successfulTrials.values()].reduce((total, trial) => total + (trial.coldProfileSampleCount || 0), 0),
  coldActiveSampleCount: [...successfulTrials.values()].reduce((total, trial) => total + (trial.coldProfileActiveSampleCount || 0), 0),
  coldIdleSampleCount: [...successfulTrials.values()].reduce((total, trial) => total + (trial.coldProfileIdleSampleCount || 0), 0),
  coldSampledCpuMs: [...successfulTrials.values()].reduce((total, trial) => total + (trial.coldProfileActiveMs || 0), 0),
  coldIdleTimeMs: [...successfulTrials.values()].reduce((total, trial) => total + (trial.coldProfileIdleMs || 0), 0),
  coldProfileWindowMs: [...successfulTrials.values()].reduce((total, trial) => total + (trial.coldProfileWindowMs || 0), 0),
  coldProfileWallMs: [...successfulTrials.values()].reduce((total, trial) => total + (trial.coldProfileWallMs || 0), 0),
  coldAdjustedSampleCount: [...successfulTrials.values()].reduce((total, trial) => total + (trial.coldProfileAdjustedSampleCount || 0), 0),
  coldExcludedDeltaUs: [...successfulTrials.values()].reduce((total, trial) => total + (trial.coldProfileExcludedDeltaUs || 0), 0),
}
const pages = renderPages(data, breakdown)
await mkdir(output, { recursive: true })
await writeFile(join(output, 'index.html'), pages.index)
await writeFile(join(output, 'breakdown.html'), pages.breakdown)
await cp(join(root, 'results/trials.json'), join(output, 'trials.json'))
await writeFile(join(output, 'profiles.json'), `${JSON.stringify(breakdown, null, 2)}\n`)
await mkdir(join(output, 'cpu-profiles'), { recursive: true })
for (const file of rawProfiles) await cp(join(root, 'results', file), join(output, 'cpu-profiles', basename(file)))
for (const file of coldRawProfiles) await cp(join(root, 'results', file), join(output, 'cpu-profiles', basename(file)))
for (const file of coldOriginalProfiles) await cp(join(root, 'results', file), join(output, 'cpu-profiles', basename(file)))
await cp(join(root, 'node_modules/speedscope/dist/release'), join(output, 'speedscope'), { recursive: true })
await cp(join(root, 'node_modules/speedscope/LICENSE'), join(output, 'speedscope/LICENSE'))
const rawTraces = await readdir(join(root, 'results')).then((files) => files.filter((file) => /^feature-trace-\d+\.json$/.test(file)))
for (const file of rawTraces) await cp(join(root, 'results', file), join(output, file))
const coldTraces = await readdir(join(root, 'results')).then((files) => files.filter((file) => /^cold-trace-\d+\.json$/.test(file)))
for (const file of coldTraces) await cp(join(root, 'results', file), join(output, file))
console.log(`Rendered benchmark pages at ${output}`)

const comparison: ComparisonData = JSON.parse(await readFile(join(root, 'results/comparison.json'), 'utf8'))
await writeFile(join(output, 'comparison.html'), renderComparison(comparison))
await cp(join(root, 'results/comparison.json'), join(output, 'comparison.json'))
