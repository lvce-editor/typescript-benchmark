import type { TargetSession } from './targetSession.ts'
import type { TypeScriptTrace } from './types.ts'

export const parsePerformanceTrace = (text: string): TypeScriptTrace | undefined => {
  const marker = text.indexOf('"schemaVersion"')
  if (marker < 0) return undefined
  let start = text.lastIndexOf('{', marker)
  while (start >= 0) {
    let depth = 0
    let string = false
    let escaped = false
    for (let index = start; index < text.length; index++) {
      const char = text[index]!
      if (string) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') string = false
        continue
      }
      if (char === '"') string = true
      else if (char === '{') depth++
      else if (char === '}' && --depth === 0) {
        try {
          const value = JSON.parse(text.slice(start, index + 1)) as TypeScriptTrace
          if (value.schemaVersion === 1 && value.fresh === true) return value
        } catch {
          break
        }
        break
      }
    }
    start = text.lastIndexOf('{', start - 1)
  }
  return undefined
}

export const requestPerformanceTrace = async (
  worker: TargetSession,
  timeoutMs: number,
  expectedFile: string,
  textDocument: { readonly text: string; readonly uri: string },
  operation: 'getPerformanceTrace' | 'getFirstPerformanceTrace' = 'getPerformanceTrace',
): Promise<TypeScriptTrace> => {
  const expression = `globalThis.rpc.invoke('TypeScriptRpc.invoke', 'Diagnostic.${operation}', ${JSON.stringify(textDocument)})`
  const response = await worker.send<{
    readonly result?: { readonly value?: TypeScriptTrace }
    readonly exceptionDetails?: { readonly text: string; readonly exception?: { readonly description?: string } }
  }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, timeoutMs)
  if (response.exceptionDetails) {
    throw new Error(`TypeScript diagnostics RPC failed: ${response.exceptionDetails.exception?.description || response.exceptionDetails.text}`)
  }
  const trace = response.result?.value
  if (!trace || trace.schemaVersion !== 1 || trace.fresh !== true) {
    throw new Error('TypeScript worker returned an invalid performance trace')
  }
  if (trace.error) {
    const stack = trace.error.details.stack ? `\n${trace.error.details.stack}` : ''
    throw new Error(`TypeScript diagnostics failed at ${trace.error.stage}: ${trace.error.details.message}${stack}`)
  }
  if (trace.file.uri && !trace.file.uri.endsWith(expectedFile)) {
    throw new Error(`TypeScript trace targeted ${trace.file.uri}; expected ${expectedFile}`)
  }
  if (!trace.file.uri) throw new Error('TypeScript performance trace did not include its document URI')
  return trace
}
