import { aggregate } from '../../benchmark/src/aggregate.ts'
import type { ProfileRow, Trial } from '../../benchmark/src/types.ts'

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
    return `<div class="metric"><div class="metric-label"><span>${escapeHtml(label)}</span><strong>${value === null ? 'unavailable' : `${value.toFixed(1)} ${unit}`}</strong></div><div class="track"><span style="width:${width}%"></span></div></div>`
  }).join('')}</section>`
}

const shell = (title: string, content: string): string => `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)} — TypeScript benchmark</title>
<style>body{font:16px system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 20px;color:#17212b;background:#f7f9fb}h1{font-size:2rem}h2{font-size:1.25rem}.nav a{margin-right:18px}.card,section{background:white;border:1px solid #dce3ea;border-radius:8px;padding:18px;margin:18px 0}.metric{margin:14px 0}.metric-label{display:flex;justify-content:space-between;gap:12px}.track{height:12px;background:#e7edf3;border-radius:6px;overflow:hidden;margin-top:6px}.track span{display:block;height:100%;background:#2276b8}.failure{color:#9c2630;white-space:pre-wrap;font-family:monospace}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #dce3ea;padding:8px;overflow-wrap:anywhere}.meta{font-size:.9rem;color:#455565}</style>
<body><h1>${escapeHtml(title)}</h1><nav class="nav"><a href="index.html">Readiness and memory</a><a href="breakdown.html">CPU breakdown</a><a href="trials.json" download>Raw trials</a></nav>${content}</body></html>`

export const renderPages = (data: BenchmarkData, profiles: readonly ProfileRow[]): { index: string; breakdown: string } => {
  const summary = aggregate(data.trials)
  const readiness = barChart('TypeScript worker startup responsiveness', ['median over successful cold trials'], [summary.readyMedianMs], 'ms')
  const memory = barChart('TypeScript worker JavaScript heap', ['median V8 used heap'], [summary.heapMedianBytes === null ? null : summary.heapMedianBytes / 1024 / 1024], 'MiB')
  const failures = data.trials.filter((trial) => !trial.success).map((trial) => `<li class="failure">${escapeHtml(`Trial ${trial.iteration}: ${trial.error || 'unknown failure'}`)}</li>`).join('')
  const metadata = `<section class="meta"><p>Editor ${escapeHtml(data.metadata.editor.tag)} (${escapeHtml(data.metadata.editor.sha256)})</p><p>TypeScript extension release ${escapeHtml(data.metadata.extension?.release || 'not separately reported')} ${escapeHtml(data.metadata.extension?.sourceCommit || '')}</p><p>Fixture ${escapeHtml(data.metadata.fixture.commit)} · ${escapeHtml(data.metadata.fixture.file)}</p><p>Node ${escapeHtml(data.metadata.node)} · ${summary.successfulTrials}/${summary.trials} trials succeeded</p><p>Readiness boundary: ${escapeHtml(data.metadata.readyBoundary)}</p><p>Memory boundary: ${escapeHtml(data.metadata.memoryBoundary)}</p><p>V8 worker heap excludes native and external memory; it is not total extension process RSS.</p></section>`
  const index = shell('TypeScript language feature benchmark', `${readiness}${memory}${metadata}<section><h2>Trial failures</h2>${failures || '<p>None</p>'}</section>`)
  const rows = profiles.slice(0, 60).map((row) => `<tr><td>${escapeHtml(row.functionName || '(anonymous)')}</td><td>${escapeHtml(row.url || '(native)')}</td><td>${row.selfTimeMs.toFixed(2)} ms</td></tr>`).join('')
  const traces = data.trials.flatMap((trial) => (trial.success && trial.featureTrace ? [trial.featureTrace] : []))
  const median = (values: number[]): number | null => {
    if (!values.length) return null
    values.sort((a, b) => a - b)
    const middle = Math.floor(values.length / 2)
    return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2
  }
  const stageNames = [...new Set(traces.flatMap((trace) => Object.keys(trace.stages || {})))].sort()
  const stageChart = barChart('Diagnostic trace stages · median per stage; stages can be nested', stageNames,
    stageNames.map((name) => median(traces.flatMap((trace) => (Number.isFinite(trace.stages?.[name]?.durationMs) ? [trace.stages![name]!.durationMs] : [])))), 'ms')
  const rpcNames = [...new Set(traces.flatMap((trace) => Object.keys(trace.syncRpc?.methods || {})))].sort()
  const rpcChart = barChart('Synchronous RPC wall time · median by method', rpcNames,
    rpcNames.map((name) => median(traces.flatMap((trace) => (Number.isFinite(trace.syncRpc?.methods[name]?.durationMs) ? [trace.syncRpc!.methods[name]!.durationMs] : [])))), 'ms')
  const breakdown = shell('TypeScript worker CPU profile', `${stageChart}${rpcChart}<section><p>The extension reports stage and synchronous RPC wall times. Stages may be nested; each is shown independently and values are not summed. The Chromium profile table shows sampled worker CPU self time, not blocked wall time.</p><p><a href="profiles.json" download>Download merged profile summary</a></p><table><thead><tr><th>Function</th><th>Source URL</th><th>Sampled self time</th></tr></thead><tbody>${rows || '<tr><td colspan="3">No CPU samples were collected.</td></tr>'}</tbody></table>${metadata}`)
  return { index, breakdown }
}
