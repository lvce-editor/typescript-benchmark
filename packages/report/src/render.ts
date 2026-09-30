import { aggregate } from '../../benchmark/src/aggregate.ts'
import { startupPhaseNames, type ProfileRow, type StartupPhaseName, type Trial } from '../../benchmark/src/types.ts'
import { formatFileSize, sortLoadedFiles } from './loadedFiles.ts'

export interface ProfileAggregateRow extends ProfileRow {
  readonly trialCount: number
}

export interface ProfileBreakdown {
  readonly rows: readonly ProfileAggregateRow[]
  readonly trialCount: number
  readonly totalSampleCount: number
  readonly sampleCount: number
  readonly idleSampleCount: number
  readonly sampledCpuMs: number
  readonly idleTimeMs: number
  readonly profileWindowMs: number
  readonly warmRequests: number
  readonly downloads: readonly string[]
}

export interface BenchmarkData {
  readonly metadata: {
    readonly node: string
    readonly editor: { readonly tag: string; readonly asset: string; readonly sha256: string }
    readonly extension?: { readonly repository: string; readonly release: string; readonly sourceCommit?: string }
    readonly fixture: { readonly repository: string; readonly commit: string; readonly file: string }
    readonly readyBoundary: string
    readonly memoryBoundary: string
  }
  readonly trials: readonly Trial[]
}

const escapeHtml = (value: unknown): string => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')

const barChart = (title: string, labels: readonly string[], values: readonly (number | null)[], unit: string): string => {
  const max = Math.max(1, ...values.filter((value): value is number => value !== null))
  return `<section><h2>${escapeHtml(title)}</h2>${labels.map((label, index) => {
    const value = values[index]
    const width = value === null ? 0 : Math.max(1, value / max * 100)
    const formatted = value === null ? 'unavailable' : `${unit === 'calls' ? value.toFixed(0) : value.toFixed(1)} ${unit}`
    return `<div class="metric"><div class="metric-label"><span>${escapeHtml(label)}</span><strong>${formatted}</strong></div><div class="track"><span style="width:${width}%"></span></div></div>`
  }).join('')}</section>`
}

const shell = (title: string, content: string): string => `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)} — TypeScript benchmark</title>
<style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px;color:#17212b;background:#f7f9fb}h1{font-size:2rem}h2{font-size:1.25rem}.nav a{margin-right:18px}.card,section{background:white;border:1px solid #dce3ea;border-radius:8px;padding:18px;margin:18px 0}.metric{margin:14px 0}.metric-label{display:flex;justify-content:space-between;gap:12px}.track{height:12px;background:#e7edf3;border-radius:6px;overflow:hidden;margin-top:6px}.track span{display:block;height:100%;background:#2276b8}.failure{color:#9c2630;white-space:pre-wrap;font-family:monospace}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #dce3ea;padding:8px;overflow-wrap:anywhere}.meta{font-size:.9rem;color:#455565}</style>
<body><h1>${escapeHtml(title)}</h1><nav class="nav"><a href="index.html">Readiness and memory</a><a href="breakdown.html">Startup and CPU breakdown</a><a href="trials.json" download>Raw trials</a></nav>${content}</body></html>`

export const renderPages = (data: BenchmarkData, profiles: ProfileBreakdown): { index: string; breakdown: string } => {
  const summary = aggregate(data.trials)
  const readiness = barChart('TypeScript worker startup responsiveness', ['median over successful cold trials'], [summary.readyMedianMs], 'ms')
  const median = (values: number[]): number | null => {
    if (!values.length) return null
    values.sort((a, b) => a - b)
    const middle = Math.floor(values.length / 2)
    return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2
  }
  const startupTrials = data.trials.filter((trial) => trial.success && trial.startupPhases && trial.readyMs !== null)
  const phaseLabels = startupPhaseNames
  const phaseTitles: Record<StartupPhaseName, string> = {
    launchToCdp: 'Launch to CDP connection', pageReady: 'Editor page ready', workerDiscovery: 'TypeScript worker discovery',
    workerProtocol: 'Worker protocol ready', fixtureRead: 'Read benchmark fixture', coldDiagnostic: 'Cold diagnostic request',
  }
  const phaseMedian = (name: string): number | null => median(startupTrials.flatMap((trial) => {
    const value = trial.startupPhases?.[name]
    return Number.isFinite(value) ? [value!] : []
  }))
  const startupValues = phaseLabels.map((name) => phaseMedian(name))
  const remainingValues = startupTrials.flatMap((trial) => {
    const phases = phaseLabels.map((name) => trial.startupPhases?.[name])
    if (phases.some((value) => !Number.isFinite(value))) return []
    return [Math.max(0, trial.readyMs! - phases.reduce<number>((total, value) => total + value!, 0))]
  })
  const startup = barChart('Cold startup phases · median sequential time',
    [...phaseLabels.map((name) => phaseTitles[name]), 'Remaining within readiness interval'],
    [...startupValues, median(remainingValues)], 'ms')
  const memory = barChart('TypeScript worker JavaScript heap', ['median V8 used heap'], [summary.heapMedianBytes === null ? null : summary.heapMedianBytes / 1024 / 1024], 'MiB')
  const failures = data.trials.filter((trial) => !trial.success).map((trial) => `<li class="failure">${escapeHtml(`Trial ${trial.iteration}: ${trial.error || 'unknown failure'}`)}</li>`).join('')
  const metadata = `<section class="meta"><p>Editor ${escapeHtml(data.metadata.editor.tag)} (${escapeHtml(data.metadata.editor.sha256)})</p><p>TypeScript extension release ${escapeHtml(data.metadata.extension?.release || 'not separately reported')} ${escapeHtml(data.metadata.extension?.sourceCommit || '')}</p><p>Fixture ${escapeHtml(data.metadata.fixture.commit)} · ${escapeHtml(data.metadata.fixture.file)}</p><p>Node ${escapeHtml(data.metadata.node)} · ${summary.successfulTrials}/${summary.trials} trials succeeded</p><p>Readiness boundary: ${escapeHtml(data.metadata.readyBoundary)}</p><p>Memory boundary: ${escapeHtml(data.metadata.memoryBoundary)}</p><p>V8 worker heap excludes native and external memory; it is not total extension process RSS.</p></section>`
  const index = shell('TypeScript language feature benchmark', `${readiness}${memory}${metadata}<section><h2>Trial failures</h2>${failures || '<p>None</p>'}</section>`)
  const rows = profiles.rows.slice(0, 60).map((row) => {
    const location = row.lineNumber >= 0 ? `:${row.lineNumber + 1}:${row.columnNumber >= 0 ? row.columnNumber + 1 : 1}` : ''
    return `<tr><td>${escapeHtml(row.functionName || '(anonymous)')}</td><td>${escapeHtml(`${row.url || '(native)'}${location}`)}</td><td>${row.selfTimeMs.toFixed(2)} ms (${row.selfPercent.toFixed(1)}%)</td><td>${row.inclusiveTimeMs.toFixed(2)} ms (${row.inclusivePercent.toFixed(1)}%)</td><td>${row.sampleCount} · ${row.trialCount}</td></tr>`
  }).join('')
  const traces = data.trials.flatMap((trial) => (trial.success && trial.coldTrace ? [trial.coldTrace] : []))
  const stageNames = [...new Set(traces.flatMap((trace) => Object.keys(trace.stages || {})))].sort()
  const stageChart = barChart('Cold diagnostic stages · median per stage; stages can be nested', stageNames,
    stageNames.map((name) => median(traces.flatMap((trace) => (Number.isFinite(trace.stages?.[name]?.durationMs) ? [trace.stages![name]!.durationMs] : [])))), 'ms')
  const rpcNames = [...new Set(traces.flatMap((trace) => Object.keys(trace.syncRpc?.methods || {})))].sort()
  const rpcDurationChart = barChart('Cold synchronous RPC wall time · median by method', rpcNames,
    rpcNames.map((name) => median(traces.flatMap((trace) => (Number.isFinite(trace.syncRpc?.methods[name]?.durationMs) ? [trace.syncRpc!.methods[name]!.durationMs] : [])))), 'ms')
  const rpcCountChart = barChart('Cold synchronous RPC calls · median by method', rpcNames,
    rpcNames.map((name) => median(traces.flatMap((trace) => (Number.isFinite(trace.syncRpc?.methods[name]?.callCount) ? [trace.syncRpc!.methods[name]!.callCount] : [])))), 'calls')
  const cpuRows = profiles.rows.slice(0, 10)
  const cpuChart = barChart('Top sampled active worker CPU self time · median percentage per trial',
    cpuRows.map((row) => `${row.functionName || '(anonymous)'} · ${row.url || '(native)'}`),
    cpuRows.map((row) => row.selfPercent), '%')
  const hotspot = cpuRows[0]
    ? `<p>Highest sampled active self-time contributor: ${escapeHtml(cpuRows[0].functionName || '(anonymous)')} in ${escapeHtml(cpuRows[0].url || '(native)')}, median ${cpuRows[0].selfTimeMs.toFixed(2)} ms (${cpuRows[0].selfPercent.toFixed(1)}% of sampled active time per trial).</p>`
    : '<p>No active sampled CPU hotspots were available in the successful profiles.</p>'
  const downloads = profiles.downloads.map((name) => `<li><a href="cpu-profiles/${escapeHtml(name)}" download>${escapeHtml(name)}</a></li>`).join('')
  const rawColdTraces = data.trials.filter((trial) => trial.success && trial.coldTracePath)
  const coldTraceLinks = rawColdTraces.map((trial) => `<li><a href="${escapeHtml(trial.coldTracePath)}" download>Trial ${trial.iteration} cold diagnostic trace</a></li>`).join('')
  const breakdown = shell('TypeScript worker startup and CPU breakdown', `${stageChart}${rpcDurationChart}${rpcCountChart}${cpuChart}<section>${hotspot}<p>The diagnostic and synchronous RPC charts use each trial's first cold diagnostic trace. Stage and RPC durations can overlap because RPC calls occur inside diagnostic stages; do not add them to each other or treat them as a partition of total startup. RPC duration includes transport and waiting and does not isolate filesystem-process execution time. The startup phase chart uses sequential intervals from the same launch instant through the readiness boundary on the overview; remaining time is shown explicitly. The CPU profile covers ${profiles.warmRequests} sequential warm calls per trial after cold readiness. Function rows show median active sampled time and percentage per trial across ${profiles.trialCount} successful profiles, with median active sample occurrences. Self time counts samples in the function itself; inclusive time also counts descendant samples, so inclusive rows overlap. V8 (idle) samples are excluded from function rankings and active-time percentages: of ${profiles.totalSampleCount} samples, ${profiles.sampleCount} active samples represent ${profiles.sampledCpuMs.toFixed(2)} ms of sampled active time and ${profiles.idleSampleCount} idle samples span ${profiles.idleTimeMs.toFixed(2)} ms, within a ${profiles.profileWindowMs.toFixed(2)} ms profile window. CPU profile sampling is distinct from wall time and blocked time.</p><p>Profiles with few active samples provide only coarse evidence; function rankings can vary between runs.</p><p><a href="profiles.json" download>Download median profile summary</a></p><h2>Raw cold diagnostic traces</h2><ul>${coldTraceLinks || '<li>No cold traces are available.</li>'}</ul><h2>Raw profiles</h2><ul>${downloads || '<li>No raw CPU profiles are available.</li>'}</ul><table><thead><tr><th>Function</th><th>Source location</th><th>Active self</th><th>Active inclusive</th><th>Samples · profiles</th></tr></thead><tbody>${rows || '<tr><td colspan="5">No active CPU samples were collected.</td></tr>'}</tbody></table>${metadata}`)
  const loadedFiles = sortLoadedFiles(traces[0]?.loadedFiles || [])
  const maxFileSize = Math.max(1, loadedFiles[0]?.sizeBytes || 0)
  const loadedFileRows = loadedFiles.map((file) => {
    const width = Math.max(1, file.sizeBytes / maxFileSize * 100)
    return `<div class="metric"><div class="metric-label"><span>${escapeHtml(file.fileName)}</span><strong>${escapeHtml(formatFileSize(file.sizeBytes))}</strong></div><div class="track"><span style="width:${width}%"></span></div></div>`
  }).join('')
  const loadedFilesMessage = traces[0]?.loadedFiles === undefined
    ? 'Loaded-file metadata was not recorded in this trace.'
    : 'No files were loaded into the TypeScript compiler program.'
  const loadedFilesCount = traces[0]?.loadedFiles === undefined ? 'file count unavailable' : `${loadedFiles.length} distinct files`
  const loadedFilesChart = `<section><h2>TypeScript language-service files · ${loadedFilesCount}</h2><p>Files in the TypeScript compiler program after semantic diagnostics during the first successful cold trial, ordered by UTF-8 source-text size. This includes loaded declaration libraries, including cached TypeScript libraries. Files only discovered while resolving the project are not counted until loaded into the program.</p>${loadedFileRows || `<p>${loadedFilesMessage}</p>`}</section>`
  return { index: index.replace('<section class="meta">', `${startup}<section class="meta">`), breakdown: breakdown.replace('<section class="meta">', `${loadedFilesChart}<section class="meta">`) }
}
