import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const cache = resolve(process.env.TYPESCRIPT_BENCHMARK_CACHE || join(root, '.tmp/cache'))
const resultPath = join(root, '.tmp/setup.json')
const editorTag = 'v0.118.23'
const extensionRelease = 'v5.25.2'
const extensionAsset = 'language-features-typescript-v5.25.2.tar.br'
const extensionSha256 = 'e75dd46f105e7240f19c2ad18f85cc9ec7768879ed917cfd474175ff8df4d750'
const editorAsset = `lvce-${editorTag}_amd64.deb`
const editorSha256 = '208d760d9d7f99cc6590732b677d3b4206145d5a911d00ea036a044abe72a3c7'
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
const extensionReleaseResponse = await fetch(`https://api.github.com/repos/lvce-editor/language-features-typescript/releases/tags/${extensionRelease}`, {
  headers: { accept: 'application/vnd.github+json', 'user-agent': 'typescript-benchmark' },
})
if (!extensionReleaseResponse.ok) throw new Error(`Unable to verify TypeScript extension release ${extensionRelease}: HTTP ${extensionReleaseResponse.status}`)
const extensionReleaseData = await extensionReleaseResponse.json() as {
  readonly html_url: string
  readonly published_at: string
  readonly target_commitish: string
  readonly assets: readonly { readonly name: string; readonly digest: string | null }[]
}
const publishedExtensionAsset = extensionReleaseData.assets.find((asset) => asset.name === extensionAsset)
if (!publishedExtensionAsset) throw new Error(`TypeScript extension release ${extensionRelease} is missing ${extensionAsset}`)
if (publishedExtensionAsset.digest !== `sha256:${extensionSha256}`) {
  throw new Error(`TypeScript extension checksum mismatch: expected ${extensionSha256}, received ${publishedExtensionAsset.digest}`)
}
const extensionArchiveResponse = await fetch(`https://github.com/lvce-editor/language-features-typescript/releases/download/${extensionRelease}/${extensionAsset}`, {
  headers: { 'user-agent': 'typescript-benchmark' },
})
if (!extensionArchiveResponse.ok) throw new Error(`Unable to download TypeScript extension ${extensionRelease}: HTTP ${extensionArchiveResponse.status}`)
const extensionArchive = Buffer.from(await extensionArchiveResponse.arrayBuffer())
const actualExtensionDigest = createHash('sha256').update(extensionArchive).digest('hex')
if (actualExtensionDigest !== extensionSha256) throw new Error(`TypeScript extension checksum mismatch: expected ${extensionSha256}, received ${actualExtensionDigest}`)
await writeFile(join(cache, extensionAsset), extensionArchive)

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
    asset: extensionAsset,
    sha256: actualExtensionDigest,
    releaseUrl: extensionReleaseData.html_url,
    publishedAt: extensionReleaseData.published_at,
    sourceCommit: extensionReleaseData.target_commitish,
  },
  fixture: { repository: aboutViewUrl, commit: fixtureRevision, file: 'packages/about-view/src/aboutWorkerMain.ts' },
}
await mkdir(dirname(resultPath), { recursive: true })
await writeFile(resultPath, `${JSON.stringify(metadata, null, 2)}\n`)
console.log(`Installed LVCE Editor ${editorTag} with TypeScript extension ${extensionRelease}; fixture ${fixtureRevision}:${metadata.fixture.file}`)
