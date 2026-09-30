import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { brotliDecompressSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const cache = resolve(process.env.TYPESCRIPT_BENCHMARK_CACHE || join(root, '.tmp/cache'))
const resultPath = join(root, '.tmp/setup.json')
const editorTag = 'v0.119.1'
const extensionRelease = 'v5.25.3'
const extensionId = 'builtin.language-features-typescript'
const editorAsset = `lvce-${editorTag}_amd64.deb`
const editorSha256 = 'e1496f4e637a755034375a137a597ce6552ed5b1c895b8a2cd9cacd2e2b1fcbe'
const extensionAsset = `language-features-typescript-${extensionRelease}.tar.br`
const extensionSha256 = '10024d377313f2b811ab1242f387e57ea46ff3dc0a69dbeba4ac1f842557b097'
const aboutViewCommit = '15fe112cf4b82ab72eaa6d29589aede9e53d96d4'
const aboutViewUrl = 'https://github.com/lvce-editor/about-view.git'
const fixtureRoot = join(cache, 'about-view')
const workspace = fixtureRoot
const fixtureFile = join(workspace, 'packages/about-view/src/aboutWorkerMain.ts')
const debPath = join(cache, editorAsset)
const extensionArchivePath = join(cache, extensionAsset)
const extensionTarPath = join(cache, `language-features-typescript-${extensionRelease}.tar`)
const extensionDirectory = join(cache, 'language-features-typescript')

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

const extensionResponse = await fetch(`https://github.com/lvce-editor/language-features-typescript/releases/download/${extensionRelease}/${extensionAsset}`, {
  headers: { 'user-agent': 'typescript-benchmark' },
})
if (!extensionResponse.ok) throw new Error(`Unable to download TypeScript language-features ${extensionRelease}: HTTP ${extensionResponse.status}`)
const extensionArchive = Buffer.from(await extensionResponse.arrayBuffer())
const actualExtensionDigest = createHash('sha256').update(extensionArchive).digest('hex')
if (actualExtensionDigest !== extensionSha256) {
  throw new Error(`TypeScript language-features ${extensionRelease} checksum mismatch: expected ${extensionSha256}, received ${actualExtensionDigest}`)
}
await writeFile(extensionArchivePath, extensionArchive)
await writeFile(extensionTarPath, brotliDecompressSync(extensionArchive))
await rm(extensionDirectory, { recursive: true, force: true })
await mkdir(extensionDirectory, { recursive: true })
run('tar', ['-xf', extensionTarPath, '-C', extensionDirectory])
const extensionManifest = JSON.parse(await readFile(join(extensionDirectory, 'extension.json'), 'utf8')) as { id?: string; version?: string }
if (extensionManifest.id !== extensionId || extensionManifest.version !== extensionRelease.slice(1)) {
  throw new Error(`Unexpected TypeScript extension in ${extensionRelease}: ${extensionManifest.id}@${extensionManifest.version}`)
}

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
    asset: extensionAsset,
    sha256: actualExtensionDigest,
    id: extensionId,
    directory: extensionDirectory,
    overridesBundled: true,
  },
  fixture: { repository: aboutViewUrl, commit: fixtureRevision, file: 'packages/about-view/src/aboutWorkerMain.ts' },
}
await mkdir(dirname(resultPath), { recursive: true })
await writeFile(resultPath, `${JSON.stringify(metadata, null, 2)}\n`)
console.log(`Installed LVCE Editor ${editorTag} with TypeScript extension ${extensionRelease}; fixture ${fixtureRevision}:${metadata.fixture.file}`)
