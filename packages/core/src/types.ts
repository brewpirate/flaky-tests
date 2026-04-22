import type { z } from 'zod'
import type {
  FailureKindSchema,
  FlakyPatternSchema,
  GetFailureKindBreakdownOptionsSchema,
  GetHotFilesOptionsSchema,
  GetNewPatternsOptionsSchema,
  GetRecentRunsOptionsSchema,
  GitInfoSchema,
  HotFileSchema,
  InsertFailureInputSchema,
  InsertRunInputSchema,
  KindBreakdownSchema,
  RecentRunSchema,
  RunStatusSchema,
  UpdateRunInputSchema,
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

/** Options for {@link IStore.getNewPatterns} — detection window and flag threshold. */
export type GetNewPatternsOptions = z.infer<typeof GetNewPatternsOptionsSchema>

/** Options for {@link IStore.getRecentRuns} — row limit for the dashboard. */
export type GetRecentRunsOptions = z.infer<typeof GetRecentRunsOptionsSchema>

/** Options for {@link IStore.getFailureKindBreakdown} — aggregation window. */
export type GetFailureKindBreakdownOptions = z.infer<
  typeof GetFailureKindBreakdownOptionsSchema
>

/** Options for {@link IStore.getHotFiles} — aggregation window + top-N limit. */
export type GetHotFilesOptions = z.infer<typeof GetHotFilesOptionsSchema>

/** A test that has newly become flaky — present in the current window but absent in the prior. */
export type FlakyPattern = z.infer<typeof FlakyPatternSchema>

/** A recent test run record for dashboard display. */
export type RecentRun = z.infer<typeof RecentRunSchema>

/** Failure count grouped by kind for the breakdown chart. */
export type KindBreakdown = z.infer<typeof KindBreakdownSchema>

/** A test file ranked by failure frequency. */
export type HotFile = z.infer<typeof HotFileSchema>

/** Git metadata captured at test-run start. */
export type GitInfo = z.infer<typeof GitInfoSchema>

/**
 * Base class for all storage-layer errors. Consumers can `instanceof StoreError`
 * to distinguish backend failures from validation or programmer errors.
 */
export class StoreError extends Error {
  override readonly name: string = 'StoreError'
}

/** Input failed schema validation before reaching the backend. */
export class ValidationError extends StoreError {
  override readonly name = 'ValidationError'
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
  getFailureKindBreakdown(
    options?: GetFailureKindBreakdownOptions,
  ): Promise<KindBreakdown[]>
  /** Returns test files ranked by failure count within the given window. */
  getHotFiles(options?: GetHotFilesOptions): Promise<HotFile[]>
  close(): Promise<void>
}
