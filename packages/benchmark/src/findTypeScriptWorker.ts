import type { TargetInfo } from './types.ts'

export const findTypeScriptWorker = (targets: readonly TargetInfo[]): TargetInfo | undefined => {
  return targets.find(({ type, url }) => type === 'worker' && /typescriptWorkerMain\.js(?:$|\?)/i.test(url))
}
