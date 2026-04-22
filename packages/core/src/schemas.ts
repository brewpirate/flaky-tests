/**
 * Zod schemas — the single source of truth for all data that crosses a
 * store boundary. Types in `./types` are inferred from these, so changing
 * a schema automatically propagates to every consumer.
 *
 * Bound rationale: sizes are capped on string fields (runId, testFile,
 * errorMessage, errorStack) to prevent a pathological stack trace from
 * blowing up the store; window/limit numbers are capped so a malformed
 * CLI flag cannot force a multi-year scan or million-row response.
 */
import { z } from 'zod'

/**
 * Coarse classification of a test failure. New variants require updates
 * to every `switch` on `FailureKind` and the matching UI color map.
 */
export const FailureKindSchema = z.enum([
  'assertion',
  'timeout',
  'uncaught',
  'unknown',
])

/** Terminal status of a completed run. Null/absent until `updateRun`. */
export const RunStatusSchema = z.enum(['pass', 'fail'])

const IsoDateTime = z.string().min(1).max(64)
const RunId = z.string().min(1).max(128)
const TestPath = z.string().min(1).max(1024)

/** Fields recorded at run start. Mirrors {@link InsertRunInput}. */
export const InsertRunInputSchema = z.object({
  runId: RunId,
  startedAt: IsoDateTime,
  gitSha: z.string().max(64).nullish(),
  gitDirty: z.boolean().nullish(),
  runtimeVersion: z.string().max(128).nullish(),
  testArgs: z.string().max(4096).nullish(),
})

/** Partial fields written at run end. All optional — stores treat
 * missing fields as no-ops, not nulls. */
export const UpdateRunInputSchema = z.object({
  endedAt: IsoDateTime.optional(),
  durationMs: z.number().int().nonnegative().optional(),
  status: RunStatusSchema.optional(),
  totalTests: z.number().int().nonnegative().optional(),
  passedTests: z.number().int().nonnegative().optional(),
  failedTests: z.number().int().nonnegative().optional(),
  errorsBetweenTests: z.number().int().nonnegative().optional(),
})

/** One test failure within a run. errorMessage/errorStack caps protect
 * storage from pathological output. */
export const InsertFailureInputSchema = z.object({
  runId: RunId,
  testFile: TestPath,
  testName: TestPath,
  failureKind: FailureKindSchema,
  errorMessage: z.string().max(16_384).nullish(),
  errorStack: z.string().max(65_536).nullish(),
  durationMs: z.number().int().nonnegative().nullish(),
  failedAt: IsoDateTime,
})

/** Controls for pattern detection — window size and flag threshold. */
export const GetNewPatternsOptionsSchema = z.object({
  windowDays: z.number().int().min(1).max(365).optional(),
  threshold: z.number().int().min(1).max(10_000).optional(),
})

/** Pagination for the recent-runs dashboard query. */
export const GetRecentRunsOptionsSchema = z.object({
  limit: z.number().int().min(1).max(1000).optional(),
})

/** Window for the kind-breakdown aggregation. */
export const GetFailureKindBreakdownOptionsSchema = z.object({
  windowDays: z.number().int().min(1).max(365).optional(),
})

/** Window + top-N limit for the hot-files ranking. */
export const GetHotFilesOptionsSchema = z.object({
  windowDays: z.number().int().min(1).max(365).optional(),
  limit: z.number().int().min(1).max(1000).optional(),
})

// --- Output schemas -------------------------------------------------------
// Derived from the same invariants as inputs so consumers that persist or
// transport these types over JSON can round-trip them safely.

/** A test that has newly become flaky — failed in the current window,
 * not in the prior window of the same length. */
export const FlakyPatternSchema = z.object({
  testFile: TestPath,
  testName: TestPath,
  recentFails: z.number().int().nonnegative(),
  priorFails: z.number().int().nonnegative(),
  failureKinds: z.array(FailureKindSchema),
  lastErrorMessage: z.string().nullable(),
  lastErrorStack: z.string().nullable(),
  lastFailed: IsoDateTime,
})

/** Dashboard row for one completed run. Nullable fields indicate a run
 * in progress or a record written before `updateRun`. */
export const RecentRunSchema = z.object({
  runId: RunId,
  startedAt: IsoDateTime,
  endedAt: IsoDateTime.nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  status: RunStatusSchema.nullable(),
  totalTests: z.number().int().nonnegative().nullable(),
  passedTests: z.number().int().nonnegative().nullable(),
  failedTests: z.number().int().nonnegative().nullable(),
  errorsBetweenTests: z.number().int().nonnegative().nullable(),
  gitSha: z.string().nullable(),
  gitDirty: z.boolean().nullable(),
})

/** One bar in the failure-kind breakdown chart. */
export const KindBreakdownSchema = z.object({
  failureKind: FailureKindSchema,
  count: z.number().int().nonnegative(),
})

/** One row in the hot-files ranking. `distinctTests` distinguishes a
 * single flaky test in a file from broad file-wide instability. */
export const HotFileSchema = z.object({
  testFile: TestPath,
  fails: z.number().int().nonnegative(),
  distinctTests: z.number().int().nonnegative(),
})

/** Git metadata captured at test-run start. Both fields nullable so a
 * non-git checkout or missing `git` binary produces a clean record. */
export const GitInfoSchema = z.object({
  sha: z.string().nullable(),
  dirty: z.boolean().nullable(),
})

/** One test failure scoped to a run, used by the per-run expand UI.
 * `errorMessage` is nullable because older inserts may have omitted it. */
export const RunFailureSchema = z.object({
  testFile: TestPath,
  testName: TestPath,
  failureKind: FailureKindSchema,
  errorMessage: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  failedAt: IsoDateTime,
})

/** Options for {@link IStore.getFailuresByRun} — the set of runIds whose
 * failures should be fetched in one round-trip. */
export const GetFailuresByRunOptionsSchema = z.object({
  runIds: z.array(RunId).min(1),
})
