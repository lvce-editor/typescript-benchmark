export interface ComparisonTrial {
  editor: string
  mode: string
  iteration: number
  success: boolean
  readyMs: number | null
  completionMs?: number | null
  diagnosticMs?: number | null
  filesystem?: { filesRead: number; readCalls: number; statCalls: number }
  error?: string
}
export interface ComparisonData {
  metadata: unknown
  trials: ComparisonTrial[]
}
const escape = (value: unknown) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const median = (values: number[]) => {
  if (!values.length) return null
  values.sort((a, b) => a - b)
  const i = Math.floor(values.length / 2)
  return values.length % 2 ? values[i] : (values[i - 1] + values[i]) / 2
}
export const renderComparison = (data: ComparisonData): string => {
  const metrics = [
    { title: 'Launch to visible TypeScript error', mode: 'timing', unit: 'ms', value: (t: ComparisonTrial) => t.readyMs },
    { title: 'Edit to visible Three.js completion', mode: 'completion', unit: 'ms', value: (t: ComparisonTrial) => t.completionMs },
    { title: 'Edit to visible Three.js diagnostic', mode: 'diagnostic', unit: 'ms', value: (t: ComparisonTrial) => t.diagnosticMs },
    { title: 'Distinct paths read before the error appears', mode: 'filesystem', unit: 'paths', value: (t: ComparisonTrial) => t.filesystem?.filesRead },
    { title: 'Path-backed read operations', mode: 'filesystem', unit: 'calls', value: (t: ComparisonTrial) => t.filesystem?.readCalls },
    { title: 'Stat-family calls before the error appears', mode: 'filesystem', unit: 'calls', value: (t: ComparisonTrial) => t.filesystem?.statCalls },
  ]
  const charts = metrics.map((metric) => {
    const rows = ['lvce', 'vscode'].map((editor) => {
      const trials = data.trials.filter((t) => t.editor === editor && t.mode === metric.mode)
      const values = trials.filter((t) => t.success).map(metric.value).filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)
      const samples = trials.map(metric.value).map((value) => typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)} ms` : 'unavailable')
      return { editor, value: median(values), count: values.length, total: trials.length, samples }
    })
    const max = Math.max(1, ...rows.map((r) => r.value || 0))
    return `<section><h2>${metric.title}</h2>${rows.map((r) => `<p>${r.editor === 'lvce' ? 'LVCE Editor' : 'VS Code'}: <strong>${r.value === null ? 'unavailable' : `${r.value.toFixed(1)} ${metric.unit}`}</strong> (${r.count}/${r.total} successful)</p>${metric.unit === 'ms' ? `<p>Samples: ${escape(r.samples.join(', '))}</p>` : ''}<div class="track"><div style="width:${(r.value || 0) / max * 100}%"></div></div>`).join('')}</section>`
  }).join('')
  const failures = data.trials.filter((t) => !t.success).map((t) => `<li>${escape(`${t.editor} ${t.iteration} ${t.mode}: ${t.error}`)}</li>`).join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TypeScript: LVCE Editor and VS Code</title>
<style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:0 20px;background:#f7f9fb;color:#17212b}section{background:white;border:1px solid #dce3ea;padding:20px;margin:20px 0}h2{font-size:1.2rem}.track{height:14px;background:#e7edf3}.track div{height:100%;background:#2276b8}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<h1>TypeScript: LVCE Editor and VS Code</h1><nav><a href="index.html">LVCE worker profiles</a> · <a href="comparison.json">Raw paired trials</a></nav>
<p>Startup and filesystem medians use the deterministic 5,001-file TypeScript project. Editing medians use the pinned Three.js fixture recorded below. Every trial uses a fresh editor profile; operating-system file caches are not cleared. Editor order alternates between iterations. These are cold editor profiles, not cold disk-cache measurements.</p>
${charts}<section><h2>What is measured</h2><p>Startup timing starts immediately before launching the executable and stops at CDP observation of a visible error underline. It includes startup, project loading, TypeScript activation and observer overhead; it is not isolated extension activation time. Filesystem traces use separate launches. Edit trials start only after the fixture's source text is rendered. Completion timing starts immediately before typing <code>scene.</code> and requesting completion with Ctrl+Space, then stops when the exact <code>add</code> Three.js member appears in the visible suggestion widget. Diagnostic timing starts immediately before typing <code>scene.definitelyMissing = 1</code> and stops after the visible error underline and TS2339 result are validated through LVCE's worker API or the VS Code hover. These are first edit requests in fresh profiles; no warm-up requests are sent, so remaining language-service activation may overlap them. Observer waits and validation work are included; screenshots are captured after the measured boundary. Timeouts, missing results and incorrect outputs fail a trial and retain null timings.</p>
<p>Tracing starts with the editor process and follows all descendant processes and threads, including language servers and filesystem workers. Counts stop at the observation of the visible underline, before hover or screenshots. Stat counts include successful and failed stat, lstat, fstat, newfstatat and statx calls. Files read means distinct absolute paths attached to successful, nonempty read/pread64/readv/preadv/preadv2 calls, including application, library and profile files; it is not compiler-loaded files, physical disk I/O or inode identity. Memory-mapped access and paths without strace descriptor annotations are excluded. Repeated reads count as operations, not additional paths. Calls crossing the interval boundary are excluded.</p>
<p>Editors retain their shipped TypeScript versions and architectures, recorded below. Results compare these editor configurations, not the TypeScript engine alone. Raw syscall traces, screenshots and logs are retained in the CI artifact.</p></section>
<section><h2>Failed trials</h2>${failures ? `<ul>${failures}</ul>` : '<p>None</p>'}</section><section><h2>Versions and fixture</h2><pre>${escape(JSON.stringify(data.metadata, null, 2))}</pre></section></html>`
}
