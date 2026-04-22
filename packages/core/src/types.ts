import type {
  failureKindSchema,
  flakyPatternSchema,
  getNewPatternsOptionsSchema,
  gitInfoSchema,
  insertFailureInputSchema,
  insertRunInputSchema,
  runStatusSchema,
  updateRunInputSchema,
} from './schemas'

/** Coarse classification of why a test failed. */
export type FailureKind = typeof failureKindSchema.infer

/** Terminal status of a completed test run. */
export type RunStatus = typeof runStatusSchema.infer

/** Fields required to record a new test run. */
export type InsertRunInput = typeof insertRunInputSchema.infer

/** Partial fields for updating a run after it completes. */
export type UpdateRunInput = typeof updateRunInputSchema.infer

/** Fields required to record a single test failure within a run. */
export type InsertFailureInput = typeof insertFailureInputSchema.infer

/** A test that has newly become flaky — present in the current window but absent in the prior. */
export type FlakyPattern = typeof flakyPatternSchema.infer

/** Options for querying new flaky patterns. */
export type GetNewPatternsOptions = typeof getNewPatternsOptionsSchema.infer

/** Git metadata captured at test-run start. */
export type GitInfo = typeof gitInfoSchema.infer

/**
 * A recorded run as surfaced to the HTML report's "Recent runs" table.
 * Strict subset of the `runs` row — everything the UI shows; nothing it
 * doesn't need. Used by {@link IStore.getRecentRuns}.
 */
export interface RecentRun {
  runId: string
  project: string | null
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

/** Options for querying recent runs. */
export interface GetRecentRunsOptions {
  limit: number
  /** Filter to a single project. Null-or-undefined matches rows whose `project` column is NULL. */
  project?: string | null
}

/**
 * Storage backend interface. All methods are async so implementations can
 * use any backend — SQLite, Supabase, Postgres, or custom.
 *
 * ## Error contract
 *
 * Implementations **MUST** wrap any driver-level error thrown by a public
 * method in a {@link StoreError} with `package`, `method`, `message`, and
 * `cause` set so callers receive a uniform error shape and the original
 * stack stays inspectable via `error.cause`. Validation errors from
 * `arktype` (thrown via {@link ValidationError}) propagate unwrapped so
 * bad input is distinguishable from a downstream driver failure.
 */
export interface IStore {
  /**
   * Create tables and run any pending schema migrations.
   * Idempotent — safe to call on every startup.
   */
  migrate(): Promise<void>
  /** Record the start of a run — paired with `updateRun` at completion. */
  insertRun(input: InsertRunInput): Promise<void>
  /** Finalize a previously-inserted run with terminal status and counts. */
  updateRun(runId: string, input: UpdateRunInput): Promise<void>
  /** Record a single test failure against an existing run. */
  insertFailure(input: InsertFailureInput): Promise<void>
  /**
   * Insert multiple failures in a single transaction. Falls back to
   * sequential inserts for backends that don't support transactions.
   * Preferred over calling insertFailure() in a loop for remote stores.
   */
  insertFailures(inputs: readonly InsertFailureInput[]): Promise<void>
  /**
   * Returns tests that newly crossed the flakiness threshold — failures in
   * the current window but none in the prior window of the same length.
   */
  getNewPatterns(options?: GetNewPatternsOptions): Promise<FlakyPattern[]>
  /**
   * Return the most recent runs ordered by `startedAt` descending. Filters
   * by `options.project` the same way `getNewPatterns` does — pass a
   * project string to isolate one project's history, or leave undefined /
   * null to match rows with NULL project. Used by the HTML report so users
   * see run history even when there are no newly-flaky patterns.
   */
  getRecentRuns(options: GetRecentRunsOptions): Promise<RecentRun[]>
  /** Release pooled connections and file handles. */
  close(): Promise<void>
}
