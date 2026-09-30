import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BenchmarkData } from './render.ts'
import { renderPages } from './render.ts'
import type { ProfileRow } from '../../benchmark/src/types.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const output = resolve(process.env.PAGES_OUTPUT || join(root, '.tmp/pages'))
const data = JSON.parse(await readFile(join(root, 'results/trials.json'), 'utf8')) as BenchmarkData
const summaries = await readdir(join(root, 'results')).then((files) => files.filter((file) => /^cpu-profile-\d+-summary\.json$/.test(file)))
const profiles = (await Promise.all(summaries.map(async (file) => JSON.parse(await readFile(join(root, 'results', file), 'utf8')) as ProfileRow[]))).flat()
profiles.sort((a, b) => b.selfTimeMs - a.selfTimeMs)
const pages = renderPages(data, profiles)
await mkdir(output, { recursive: true })
await writeFile(join(output, 'index.html'), pages.index)
await writeFile(join(output, 'breakdown.html'), pages.breakdown)
await cp(join(root, 'results/trials.json'), join(output, 'trials.json'))
await writeFile(join(output, 'profiles.json'), `${JSON.stringify(profiles, null, 2)}\n`)
const rawProfiles = await readdir(join(root, 'results')).then((files) => files.filter((file) => /^cpu-profile-\d+\.json$/.test(file)))
await mkdir(join(output, 'cpu-profiles'), { recursive: true })
for (const file of rawProfiles) await cp(join(root, 'results', file), join(output, 'cpu-profiles', basename(file)))
const rawTraces = await readdir(join(root, 'results')).then((files) => files.filter((file) => /^feature-trace-\d+\.json$/.test(file)))
for (const file of rawTraces) await cp(join(root, 'results', file), join(output, file))
console.log(`Rendered benchmark pages at ${output}`)
