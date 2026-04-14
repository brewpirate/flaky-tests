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
 * Storage backend interface. All methods are async so implementations can
 * use any backend — SQLite, Supabase, Postgres, or custom.
 */
export interface IStore {
  /**
   * Create tables and run any pending schema migrations.
   * Idempotent — safe to call on every startup.
   */
  migrate(): Promise<void>
  insertRun(input: InsertRunInput): Promise<void>
  updateRun(runId: string, input: UpdateRunInput): Promise<void>
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
  close(): Promise<void>
}
