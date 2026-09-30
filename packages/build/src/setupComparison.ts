import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
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
await writeFile('.tmp/comparison-setup.json', JSON.stringify({
  vscode: { version: manifest.version, commit, sha256, typescript: ts.version, binary: join(directory, 'code') },
  fixture: { version: 1, files: 5001, sha256: fixtureSha256, workspace, file: join(workspace, 'benchmark.ts'), expected: "Type 'string' is not assignable to type 'number'.", code: 2322, line: 1 },
}, null, 2))
