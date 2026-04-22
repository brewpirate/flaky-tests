import type { z } from 'zod'
import type {
  FailureKindSchema,
  RunStatusSchema,
  InsertRunInputSchema,
  UpdateRunInputSchema,
  InsertFailureInputSchema,
  GetNewPatternsOptionsSchema,
  GetRecentRunsOptionsSchema,
  GetFailureKindBreakdownOptionsSchema,
  GetHotFilesOptionsSchema,
} from './schemas'

/** Coarse classification of why a test failed. */
export type FailureKind = z.infer<typeof FailureKindSchema>

/** Terminal status of a completed run. */
export type RunStatus = z.infer<typeof RunStatusSchema>

/** Fields required to record a new test run. */
export type InsertRunInput = z.infer<typeof InsertRunInputSchema>

/** Partial fields for updating a run after it completes. */
export type UpdateRunInput = z.infer<typeof UpdateRunInputSchema>

/** Fields required to record a single test failure within a run. */
export type InsertFailureInput = z.infer<typeof InsertFailureInputSchema>

export type GetNewPatternsOptions = z.infer<typeof GetNewPatternsOptionsSchema>
export type GetRecentRunsOptions = z.infer<typeof GetRecentRunsOptionsSchema>
export type GetFailureKindBreakdownOptions = z.infer<typeof GetFailureKindBreakdownOptionsSchema>
export type GetHotFilesOptions = z.infer<typeof GetHotFilesOptionsSchema>

/** A test that has newly become flaky — present in the current window but absent in the prior. */
export interface FlakyPattern {
  testFile: string
  testName: string
  /** Failure count in the current window */
  recentFails: number
  /** Failure count in the equally-sized window immediately before */
  priorFails: number
  failureKinds: FailureKind[]
  lastErrorMessage: string | null
  lastErrorStack: string | null
  lastFailed: string
}

/** A recent test run record for dashboard display. */
export interface RecentRun {
  runId: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  status: RunStatus | null
  totalTests: number | null
  passedTests: number | null
  failedTests: number | null
  errorsBetweenTests: number | null
  gitSha: string | null
  gitDirty: boolean | null
}

/** Failure count grouped by kind for the breakdown chart. */
export interface KindBreakdown {
  failureKind: FailureKind
  count: number
}

/** A test file ranked by failure frequency. */
export interface HotFile {
  testFile: string
  fails: number
  distinctTests: number
}

/**
 * Base class for all storage-layer errors. Consumers can `instanceof StoreError`
 * to distinguish backend failures from validation or programmer errors.
 */
export class StoreError extends Error {
  override readonly name: string = 'StoreError'
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
  }
}

/** Input failed schema validation before reaching the backend. */
export class ValidationError extends StoreError {
  override readonly name = 'ValidationError'
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
  }
}

/**
 * Storage backend interface. All methods are async so implementations can
 * use any backend — SQLite, Supabase, Postgres, or custom.
 *
 * Contract:
 * - Implementations SHOULD validate inputs (via the exported zod schemas)
 *   and throw `ValidationError` on bad data rather than letting it reach
 *   the backend.
 * - Backend/IO failures SHOULD be wrapped in `StoreError` with the original
 *   error set as `cause`.
 * - `close()` MUST be idempotent — calling it twice MUST NOT throw.
 * - No method guarantees retry or timeout behavior; callers that need those
 *   should wrap the store (e.g. with p-retry or AbortSignal).
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
  /** Returns the most recent test runs, ordered newest first. */
  getRecentRuns(options?: GetRecentRunsOptions): Promise<RecentRun[]>
  /** Returns failure counts grouped by failure kind within the given window. */
  getFailureKindBreakdown(options?: GetFailureKindBreakdownOptions): Promise<KindBreakdown[]>
  /** Returns test files ranked by failure count within the given window. */
  getHotFiles(options?: GetHotFilesOptions): Promise<HotFile[]>
  close(): Promise<void>
}
