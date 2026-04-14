export type FailureKind = 'assertion' | 'timeout' | 'uncaught' | 'unknown'

export interface InsertRunInput {
  runId: string
  startedAt: string
  gitSha?: string | null
  gitDirty?: boolean | null
  runtimeVersion?: string | null
  testArgs?: string | null
}

export interface UpdateRunInput {
  endedAt?: string
  durationMs?: number
  status?: 'pass' | 'fail'
  totalTests?: number
  passedTests?: number
  failedTests?: number
  errorsBetweenTests?: number
}

export interface InsertFailureInput {
  runId: string
  testFile: string
  testName: string
  failureKind: FailureKind
  errorMessage?: string | null
  errorStack?: string | null
  durationMs?: number | null
  failedAt: string
}

/**
 * Storage backend interface. All methods are async so implementations can
 * use any backend — SQLite, Supabase, Postgres, or custom.
 */
export interface IStore {
  insertRun(input: InsertRunInput): Promise<void>
  updateRun(runId: string, input: UpdateRunInput): Promise<void>
  insertFailure(input: InsertFailureInput): Promise<void>
  close(): Promise<void>
}
