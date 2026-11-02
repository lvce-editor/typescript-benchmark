import { readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// Diagnostic-only patch of the extracted test application, never the installed editor.
const setup = JSON.parse(await readFile('.tmp/setup.json', 'utf8'))
const app = join(dirname(setup.editor.binary), 'resources/app')
const assets = (await readdir(join(app, 'static'), { withFileTypes: true })).filter(entry => entry.isDirectory())
if (assets.length !== 1) throw new Error('Expected exactly one versioned static directory')
const packages = join(app, 'static', assets[0].name, 'packages')
const capture = `
globalThis.___receivedMessages = [];
const captureCompletionEvent = (type, payload) => {
  const seen = new WeakSet();
  let safePayload;
  try {
    safePayload = JSON.parse(JSON.stringify(payload, (key, value) => {
      if (typeof value === 'bigint') return String(value);
      if (value && typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    }));
  } catch { safePayload = { serializationError: true }; }
  globalThis.___receivedMessages.push({ sequence: globalThis.___receivedMessages.length, timestamp: performance.now(), wallTime: Date.now(), direction: type, type, payload: safePayload });
};
`
const replace = (source: string, target: string, replacement: string): string => {
  if (source.split(target).length !== 2) throw new Error(`Expected exactly one diagnostic patch target: ${target}`)
  return source.replace(target, replacement)
}
for (const worker of ['renderer-process', 'editor-worker']) {
  const file = join(packages, worker, 'dist', worker === 'renderer-process' ? 'rendererProcessMain.js' : 'editorWorkerMain.js')
  let source = await readFile(file, 'utf8')
  if (source.includes('captureCompletionEvent')) throw new Error(`Already patched: ${file}`)
  if (worker === 'renderer-process') {
    source = replace(source, 'const handleMessage = event => {', `const handleMessage = event => {
  captureCompletionEvent('renderer-worker->renderer-process', event.data);`)
    source = replace(source, 'const sendKeyBinding = identifier => {', `const sendKeyBinding = identifier => {
  captureCompletionEvent('keybinding', {identifier});`)
  } else {
    source = replace(source, 'const openCompletion = async (editor, automatic = false) => {', `const openCompletion = async (editor, automatic = false) => {
  captureCompletionEvent('openCompletion', {uid: editor.uid, automatic, selections: Array.from(editor.selections), lines: editor.lines});`)
    source = replace(source, "  await invoke$4('Completions.loadContent', uid, automatic);\n  if (automatic", `  await invoke$4('Completions.loadContent', uid, automatic);
  captureCompletionEvent('completion-loaded', {uid, automatic});
  if (automatic`)
    source = replace(source, '  if (created && (!wasAdded || !isCurrent$1(editor, currentEditor))) {', `  captureCompletionEvent('completion-result', {uid: editor.uid, completionUid, wasAdded, current: isCurrent$1(editor, currentEditor), changed: Object.keys(editor).filter(key => editor[key] !== currentEditor?.[key])});
  if (created && (!wasAdded || !isCurrent$1(editor, currentEditor))) {`)
    source = replace(source, 'const merge = (current, snapshot, result) => {', `const merge = (current, snapshot, result) => {
  captureCompletionEvent('merge', {uid: current.uid, current: isCurrent$1(snapshot, current), unchanged: result === snapshot, changed: Object.keys(snapshot).filter(key => snapshot[key] !== current[key])});`)
  }
  await writeFile(file, capture + source)
  console.log(`Patched diagnostic bundle: ${file}`)
}
