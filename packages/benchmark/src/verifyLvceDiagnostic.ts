import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import type { Browser } from 'playwright'
import { TargetSession } from './targetSession.ts'
import { findTypeScriptWorker } from './findTypeScriptWorker.ts'
import type { TargetInfo } from './types.ts'

// Runs after the visible underline boundary, never as a readiness trigger.
export const verifyLvceDiagnostic = async (browser: Browser, file: string, expected: string) => {
  const root = await browser.newBrowserCDPSession()
  let worker: TargetSession | undefined
  try {
    const { targetInfos } = await root.send('Target.getTargets') as { targetInfos: TargetInfo[] }
    const target = findTypeScriptWorker(targetInfos)
    if (!target) throw new Error('TypeScript worker missing after visible diagnostic')
    const { sessionId } = await root.send('Target.attachToTarget', { targetId: target.targetId, flatten: false })
    worker = new TargetSession(root, sessionId)
    const document = { uri: pathToFileURL(file).href, text: await readFile(file, 'utf8') }
    const response = await worker.send<{ result?: { value?: { code: number; rowIndex: number; columnIndex: number; uri: string; message: string }[] }; exceptionDetails?: unknown }>('Runtime.evaluate', {
      expression: `globalThis.rpc.invoke('TypeScriptRpc.invoke', 'Diagnostic.getDiagnostics', ${JSON.stringify(document)})`, awaitPromise: true, returnByValue: true,
    }, 30000)
    const diagnostics = response.result?.value
    if (response.exceptionDetails || !Array.isArray(diagnostics) || diagnostics.length !== 1 || diagnostics[0].code !== 2322 || diagnostics[0].rowIndex !== 0 || diagnostics[0].columnIndex !== 13 || diagnostics[0].uri !== document.uri || diagnostics[0].message !== expected) {
      throw new Error(`Unexpected diagnostic after visible underline: ${JSON.stringify(response)}`)
    }
    return diagnostics
  } finally {
    await worker?.close()
    await root.detach().catch(() => {})
  }
}
