import { createHash } from 'node:crypto'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const cache = resolve(process.env.TYPESCRIPT_BENCHMARK_CACHE || '.tmp/cache')
const commit = '07f806f999227108933c2e30515b26eecc1fda74'
const sha256 = 'd32031e9e213d59532af3cf32fcb8b357a1cdd10417967b4f5b5ba30436dc0dc'
const response = await fetch(`https://update.code.visualstudio.com/commit:${commit}/linux-x64/stable`)
if (!response.ok) throw new Error(`VS Code download: ${response.status}`)
const bytes = Buffer.from(await response.arrayBuffer())
if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error('VS Code checksum mismatch')
await mkdir(cache, { recursive: true })
const archive = join(cache, 'vscode.tar.gz')
await writeFile(archive, bytes)
await rm(join(cache, 'VSCode-linux-x64'), { recursive: true, force: true })
const extract = spawnSync('tar', ['-xzf', archive, '-C', cache], { stdio: 'inherit' })
if (extract.status !== 0) throw new Error('VS Code extraction failed')
const directory = join(cache, 'VSCode-linux-x64')
const manifest = JSON.parse(await readFile(join(directory, 'resources/app/package.json'), 'utf8'))
const ts = JSON.parse(await readFile(join(directory, 'resources/app/extensions/node_modules/typescript/package.json'), 'utf8'))
// A deterministic large project, with all 5,000 modules reachable from the opened file.
const workspace = join(cache, 'comparison-fixture-v1')
await rm(workspace, { recursive: true, force: true })
await mkdir(workspace, { recursive: true })
const files: Record<string, string> = {
  'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' }, include: ['*.ts'] }),
  'benchmark.ts': 'export const benchmarkError: number = "benchmark-error";\n' + Array.from({ length: 5000 }, (_, i) => `export { value as value${i} } from "./module${i}";\n`).join(''),
}
for (let i = 0; i < 5000; i++) files[`module${i}.ts`] = `export const value: number = ${i};\n`
const digest = createHash('sha256')
for (const [name, content] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
  digest.update(name).update('\0').update(content).update('\0')
  await writeFile(join(workspace, name), content)
}
const fixtureSha256 = digest.digest('hex')
if (fixtureSha256 !== 'd50283eee3c612b9e0092818fa1fc1ff56d50b95307e2afc0202615c2e2611cf') throw new Error('Fixture v1 content changed; update its version and digest intentionally')
const editingFixtureSource = resolve('packages/build/fixtures/threejs')
const editingWorkspace = join(cache, 'threejs-fixture-v1')
await rm(editingWorkspace, { recursive: true, force: true })
await mkdir(editingWorkspace, { recursive: true })
await cp(editingFixtureSource, editingWorkspace, { recursive: true })
const editingFiles = ['benchmark.ts', 'package-lock.json', 'package.json', 'tsconfig.json']
const editingDigest = createHash('sha256')
for (const name of editingFiles) editingDigest.update(name).update('\0').update(await readFile(join(editingWorkspace, name))).update('\0')
const editingFixtureSha256 = editingDigest.digest('hex')
if (editingFixtureSha256 !== '24d382a77e0c144eb969d31150b2174e1a5c0e14a7a4edef1e7640369fe3d900') throw new Error('Three.js fixture v1 content changed; update its version and digest intentionally')
const install = spawnSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: editingWorkspace, stdio: 'inherit' })
if (install.status !== 0) throw new Error(`Three.js fixture dependency install failed: ${install.status ?? install.error}`)
const editingPackage = JSON.parse(await readFile(join(editingWorkspace, 'node_modules/three/package.json'), 'utf8'))
if (editingPackage.version !== '0.186.1') throw new Error(`Unexpected Three.js version: ${editingPackage.version}`)
const editingTypes = JSON.parse(await readFile(join(editingWorkspace, 'node_modules/@types/three/package.json'), 'utf8'))
if (editingTypes.version !== '0.186.0') throw new Error(`Unexpected @types/three version: ${editingTypes.version}`)
await writeFile('.tmp/comparison-setup.json', JSON.stringify({
  vscode: { version: manifest.version, commit, sha256, typescript: ts.version, binary: join(directory, 'code') },
  fixture: { version: 1, files: 5001, sha256: fixtureSha256, workspace, file: join(workspace, 'benchmark.ts'), expected: "Type 'string' is not assignable to type 'number'.", code: 2322, line: 1 },
  editingFixture: { version: 1, files: editingFiles, sha256: editingFixtureSha256, workspace: editingWorkspace, file: join(editingWorkspace, 'benchmark.ts'), package: 'three', packageVersion: editingPackage.version, typesVersion: editingTypes.version, completion: 'add', diagnosticCode: 2339, diagnosticMessage: 'definitelyMissing' },
}, null, 2))
