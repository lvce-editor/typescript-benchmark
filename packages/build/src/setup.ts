import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const cache = resolve(process.env.TYPESCRIPT_BENCHMARK_CACHE || join(root, '.tmp/cache'))
const resultPath = join(root, '.tmp/setup.json')
const editorTag = 'v0.119.1'
const extensionRelease = 'v5.25.3'
const editorAsset = `lvce-${editorTag}_amd64.deb`
const editorSha256 = 'e1496f4e637a755034375a137a597ce6552ed5b1c895b8a2cd9cacd2e2b1fcbe'
const aboutViewCommit = '15fe112cf4b82ab72eaa6d29589aede9e53d96d4'
const aboutViewUrl = 'https://github.com/lvce-editor/about-view.git'
const fixtureRoot = join(cache, 'about-view')
const workspace = fixtureRoot
const fixtureFile = join(workspace, 'packages/about-view/src/aboutWorkerMain.ts')
const debPath = join(cache, editorAsset)

const run = (command: string, args: string[], options: { cwd?: string; stdio?: 'inherit' | 'pipe' } = {}): string => {
  const result = spawnSync(command, args, { cwd: options.cwd, encoding: 'utf8', stdio: options.stdio || 'pipe' })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.stdout || result.error}`)
  }
  return result.stdout || ''
}

await mkdir(cache, { recursive: true })
const response = await fetch(`https://github.com/lvce-editor/lvce-editor/releases/download/${editorTag}/${editorAsset}`, {
  headers: { 'user-agent': 'typescript-benchmark' },
})
if (!response.ok) throw new Error(`Unable to download LVCE Editor ${editorTag}: HTTP ${response.status}`)
const deb = Buffer.from(await response.arrayBuffer())
const actualDigest = createHash('sha256').update(deb).digest('hex')
if (actualDigest !== editorSha256) throw new Error(`LVCE Editor checksum mismatch: expected ${editorSha256}, received ${actualDigest}`)
await writeFile(debPath, deb)
if (process.platform !== 'linux') throw new Error('The official LVCE Debian benchmark setup requires Linux')
run('sudo', ['apt-get', 'update'], { stdio: 'inherit' })
run('sudo', ['apt-get', 'install', '-y', debPath], { stdio: 'inherit' })

try {
  await readFile(join(fixtureRoot, '.git', 'HEAD'))
} catch {
  await mkdir(dirname(fixtureRoot), { recursive: true })
  run('git', ['clone', '--no-checkout', aboutViewUrl, fixtureRoot], { stdio: 'inherit' })
}
run('git', ['-C', fixtureRoot, 'fetch', '--depth=1', 'origin', aboutViewCommit])
run('git', ['-C', fixtureRoot, 'checkout', '--detach', aboutViewCommit])
const fixtureRevision = run('git', ['-C', fixtureRoot, 'rev-parse', 'HEAD']).trim()
if (fixtureRevision !== aboutViewCommit) throw new Error(`Unexpected about-view fixture revision ${fixtureRevision}`)
await readFile(fixtureFile)
run('npm', ['ci', '--ignore-scripts'], { cwd: fixtureRoot, stdio: 'inherit' })

const metadata = {
  editor: { tag: editorTag, asset: editorAsset, sha256: actualDigest },
  extension: {
    repository: 'https://github.com/lvce-editor/language-features-typescript',
    release: extensionRelease,
    bundled: true,
  },
  fixture: { repository: aboutViewUrl, commit: fixtureRevision, file: 'packages/about-view/src/aboutWorkerMain.ts' },
}
await mkdir(dirname(resultPath), { recursive: true })
await writeFile(resultPath, `${JSON.stringify(metadata, null, 2)}\n`)
console.log(`Installed LVCE Editor ${editorTag} with TypeScript extension ${extensionRelease}; fixture ${fixtureRevision}:${metadata.fixture.file}`)
