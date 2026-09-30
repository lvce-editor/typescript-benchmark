import type { Page } from 'playwright'
import type { TypeScriptTrace } from './types.ts'
import { waitFor } from './waitFor.ts'

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

export const requestPerformanceTrace = async (page: Page, timeoutMs: number, expectedFile: string): Promise<TypeScriptTrace> => {
  await page.bringToFront()
  await page.keyboard.press('Control+Shift+P')
  await page.keyboard.type('typescript.showPerformanceTrace')
  await page.keyboard.press('Enter')
  const trace = await waitFor(async () => {
    const editorLines = await page.locator('.view-line:visible').allTextContents().catch(() => [])
    const bodyText = await page.locator('body').innerText().catch(() => '')
    const output = editorLines.length ? editorLines.join('\n') : bodyText
    return parsePerformanceTrace(output)
  }, timeoutMs, 200)
  if (trace.error) throw new Error(`TypeScript diagnostics failed at ${trace.error.stage}: ${trace.error.details.message}`)
  if (trace.file.uri && !trace.file.uri.endsWith(expectedFile)) {
    throw new Error(`TypeScript trace targeted ${trace.file.uri}; expected ${expectedFile}`)
  }
  if (!trace.file.uri) throw new Error('TypeScript performance trace did not include its document URI')
  return trace
}
