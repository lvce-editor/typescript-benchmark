export interface Trial {
  readonly iteration: number
  readonly success: boolean
  readonly readyMs: number | null
  readonly startupPhases?: Readonly<Record<string, number>>
  readonly heapUsedBytes: number | null
  readonly processMemoryBytes: number | null
  readonly workerUrl?: string
  readonly profilePath?: string
  readonly featureTracePath?: string
  readonly featureTrace?: TypeScriptTrace
  readonly coldTracePath?: string
  readonly coldTrace?: TypeScriptTrace
  readonly profileRequests?: number
  readonly profileSampleCount?: number
  readonly profileActiveSampleCount?: number
  readonly profileIdleSampleCount?: number
  readonly profileActiveMs?: number
  readonly profileIdleMs?: number
  readonly profileWindowMs?: number
  readonly error?: string
}

export const startupPhaseNames = [
  'launchToCdp',
  'pageReady',
  'workerDiscovery',
  'workerProtocol',
  'fixtureRead',
  'coldDiagnostic',
] as const

export type StartupPhaseName = (typeof startupPhaseNames)[number]

export interface TypeScriptTrace {
  readonly file: { readonly uri?: string }
  readonly fresh: true
  readonly schemaVersion: 1
  readonly totalDurationMs: number
  readonly languageService?: { readonly cache: 'created' | 'reused'; readonly configPath?: string; readonly fileCount?: number }
  readonly commandDurationMs?: number
  readonly error?: { readonly stage: string; readonly details: { readonly message: string; readonly stack?: string } }
  readonly loadedFiles?: readonly LoadedFile[]
  readonly stages?: Readonly<Record<string, { readonly durationMs: number }>>
  readonly syncRpc?: { readonly callCount: number; readonly durationMs: number; readonly methods: Readonly<Record<string, { readonly callCount: number; readonly durationMs: number }>> }
}

export interface LoadedFile {
  readonly fileName: string
  readonly sizeBytes: number
}

export interface CpuProfile {
  readonly nodes: readonly { readonly id: number; readonly callFrame: { readonly functionName: string; readonly url: string; readonly lineNumber?: number; readonly columnNumber?: number }; readonly children?: readonly number[] }[]
  readonly samples: readonly number[]
  readonly timeDeltas: readonly number[]
}

export interface ProfileRow {
  readonly functionName: string
  readonly url: string
  readonly lineNumber: number
  readonly columnNumber: number
  readonly selfTimeMs: number
  readonly inclusiveTimeMs: number
  readonly selfPercent: number
  readonly inclusivePercent: number
  readonly sampleCount: number
}

export interface CpuProfileSummary {
  readonly rows: readonly ProfileRow[]
  readonly sampleCount: number
  readonly activeSampleCount: number
  readonly idleSampleCount: number
  readonly activeMs: number
  readonly idleMs: number
  readonly profileWindowMs: number
}

export interface TargetInfo {
  readonly targetId: string
  readonly type: string
  readonly url: string
  readonly title: string
}
