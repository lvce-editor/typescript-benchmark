export interface ComparisonTrial {
  editor: string
  mode: string
  iteration: number
  success: boolean
  readyMs: number | null
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
    { title: 'Distinct paths read before the error appears', mode: 'filesystem', unit: 'paths', value: (t: ComparisonTrial) => t.filesystem?.filesRead },
    { title: 'Path-backed read operations', mode: 'filesystem', unit: 'calls', value: (t: ComparisonTrial) => t.filesystem?.readCalls },
    { title: 'Stat-family calls before the error appears', mode: 'filesystem', unit: 'calls', value: (t: ComparisonTrial) => t.filesystem?.statCalls },
  ]
  const charts = metrics.map((metric) => {
    const rows = ['lvce', 'vscode'].map((editor) => {
      const trials = data.trials.filter((t) => t.editor === editor && t.mode === metric.mode)
      const values = trials.filter((t) => t.success).map(metric.value).filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0)
      return { editor, value: median(values), count: values.length, total: trials.length }
    })
    const max = Math.max(1, ...rows.map((r) => r.value || 0))
    return `<section><h2>${metric.title}</h2>${rows.map((r) => `<p>${r.editor === 'lvce' ? 'LVCE Editor' : 'VS Code'}: <strong>${r.value === null ? 'unavailable' : `${r.value.toFixed(1)} ${metric.unit}`}</strong> (${r.count}/${r.total} successful)</p><div class="track"><div style="width:${(r.value || 0) / max * 100}%"></div></div>`).join('')}</section>`
  }).join('')
  const failures = data.trials.filter((t) => !t.success).map((t) => `<li>${escape(`${t.editor} ${t.iteration} ${t.mode}: ${t.error}`)}</li>`).join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>TypeScript: LVCE Editor and VS Code</title>
<style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:0 20px;background:#f7f9fb;color:#17212b}section{background:white;border:1px solid #dce3ea;padding:20px;margin:20px 0}h2{font-size:1.2rem}.track{height:14px;background:#e7edf3}.track div{height:100%;background:#2276b8}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<h1>TypeScript: LVCE Editor and VS Code</h1><nav><a href="index.html">LVCE worker profiles</a> · <a href="comparison.json">Raw paired trials</a></nav>
<p>Medians on the same deterministic 5,001-file TypeScript project. Fresh editor profiles; operating-system file caches are not cleared. Editor order alternates between iterations. These are launch-to-diagnostic measurements, not isolated extension activation times.</p>
${charts}<section><h2>What is measured</h2><p>Timing starts immediately before process launch and ends when the first error underline is observed visible through CDP. After that boundary, each trial must verify the expected TypeScript 2322 error. VS Code uses its visible hover message; LVCE validates the sole first-line diagnostic through its TypeScript worker API because its diagnostic hover is unavailable. This verification does not trigger readiness. Polling, CDP connection and editor startup are included. Filesystem measurements use separate fresh launches under strace; their slower elapsed times are not mixed into timing medians.</p>
<p>Tracing starts with the editor process and follows all descendant processes and threads, including language servers and filesystem workers. Counts stop at the observation of the visible underline, before hover or screenshots. Stat counts include successful and failed stat, lstat, fstat, newfstatat and statx calls. Files read means distinct absolute paths attached to successful, nonempty read/pread64/readv/preadv/preadv2 calls, including application, library and profile files; it is not compiler-loaded files, physical disk I/O or inode identity. Memory-mapped access and paths without strace descriptor annotations are excluded. Repeated reads count as operations, not additional paths. Calls crossing the interval boundary are excluded.</p>
<p>Editors retain their shipped TypeScript versions and architectures, recorded below. Results compare these editor configurations, not the TypeScript engine alone. Raw syscall traces, screenshots and logs are retained in the CI artifact.</p></section>
<section><h2>Failed trials</h2>${failures ? `<ul>${failures}</ul>` : '<p>None</p>'}</section><section><h2>Versions and fixture</h2><pre>${escape(JSON.stringify(data.metadata, null, 2))}</pre></section></html>`
}
