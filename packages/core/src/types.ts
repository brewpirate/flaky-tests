/** Coarse classification of why a test failed. */
export type FailureKind = 'assertion' | 'timeout' | 'uncaught' | 'unknown'

/** Fields required to record a new test run. */
export interface InsertRunInput {
  runId: string
  startedAt: string
  gitSha?: string | null
  gitDirty?: boolean | null
  runtimeVersion?: string | null
  testArgs?: string | null
}

/** Partial fields for updating a run after it completes. */
export interface UpdateRunInput {
  endedAt?: string
  durationMs?: number
  status?: 'pass' | 'fail'
  totalTests?: number
  passedTests?: number
  failedTests?: number
  errorsBetweenTests?: number
}

/** Fields required to record a single test failure within a run. */
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

/** A test that has newly become flaky — present in the current window but absent in the prior. */
export interface FlakyPattern {
  testFile: string
  testName: string
  /** Failure count in the current window */
  recentFails: number
  /** Failure count in the equally-sized window immediately before */
  priorFails: number
  failureKinds: string[]
  lastErrorMessage: string | null
  lastErrorStack: string | null
  lastFailed: string
}

export interface GetNewPatternsOptions {
  /** How many days to look back for the current window. Default: 7 */
  windowDays?: number
  /** Minimum failures in current window to be flagged. Default: 2 */
  threshold?: number
}

/**
 * Storage backend interface. All methods are async so implementations can
 * use any backend — SQLite, Supabase, Postgres, or custom.
 */
export interface IStore {
  insertRun(input: InsertRunInput): Promise<void>
  updateRun(runId: string, input: UpdateRunInput): Promise<void>
  insertFailure(input: InsertFailureInput): Promise<void>
  /**
   * Returns tests that newly crossed the flakiness threshold — failures in
   * the current window but none in the prior window of the same length.
   */
  getNewPatterns(options?: GetNewPatternsOptions): Promise<FlakyPattern[]>
  close(): Promise<void>
}
