import { copyFile, readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// Diagnostic integration of a published worker into the extracted test application.
// This does not represent a new official LVCE release.
const setup = JSON.parse(await readFile('.tmp/setup.json', 'utf8'))
const manifest = JSON.parse(await readFile('.tmp/candidate/package/package.json', 'utf8'))
if (manifest.name !== '@lvce-editor/editor-worker' || manifest.version !== '19.78.14') {
  throw new Error(`Unexpected candidate: ${manifest.name}@${manifest.version}`)
}
const app = join(dirname(setup.editor.binary), 'resources/app')
const assets = (await readdir(join(app, 'static'), { withFileTypes: true })).filter(entry => entry.isDirectory())
if (assets.length !== 1) throw new Error('Expected exactly one versioned static directory')
const target = join(app, 'static', assets[0].name, 'packages/editor-worker/dist/editorWorkerMain.js')
await copyFile('.tmp/candidate/package/dist/editorWorkerMain.js', target)
console.log(`Testing published ${manifest.name}@${manifest.version} in ${setup.editor.tag}: ${target}`)
