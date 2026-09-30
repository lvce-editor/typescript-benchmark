import type { TargetInfo } from './types.ts'

export const findTypeScriptWorker = (targets: readonly TargetInfo[]): TargetInfo | undefined => {
  return targets.find(({ type, title }) => type === 'worker' && /TypeScript Worker$/i.test(title))
}
