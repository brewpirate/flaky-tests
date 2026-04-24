import { type Type, type } from 'arktype'

// ---------------------------------------------------------------------------
// Reusable constraints
// ---------------------------------------------------------------------------

const isoTimestamp: Type<string> = type('string').narrow(
  (value, ctx) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
    ctx.reject({
      expected: 'an ISO 8601 timestamp (YYYY-MM-DDTHH:mm:ss.sssZ)',
    }),
)

const nonEmptyString: Type<string> = type.string.atLeastLength(1)
const nonNegativeInt: Type<number> = type('number.integer >= 0')
const positiveInt: Type<number> = type('number.integer > 0')

// ---------------------------------------------------------------------------
// Domain schemas
// ---------------------------------------------------------------------------

/** Coarse classification of why a test failed. */
export const failureKindSchema: Type<
  'assertion' | 'timeout' | 'uncaught' | 'unknown'
> = type("'assertion' | 'timeout' | 'uncaught' | 'unknown'")

/** Terminal status of a completed test run. */
export const runStatusSchema: Type<'pass' | 'fail'> = type("'pass' | 'fail'")

/** Fields required to record a new test run. */
export const insertRunInputSchema: Type<{
  runId: string
  startedAt: string
  project?: string | null
  gitSha?: string | null
  gitDirty?: boolean | null
  runtimeVersion?: string | null
  testArgs?: string | null
}> = type({
  runId: nonEmptyString,
  startedAt: isoTimestamp,
  'project?': 'string | null',
  'gitSha?': 'string | null',
  'gitDirty?': 'boolean | null',
  'runtimeVersion?': 'string | null',
  'testArgs?': 'string | null',
})

/** Partial fields for updating a run after it completes. */
export const updateRunInputSchema: Type<{
  endedAt?: string
  durationMs?: number
  status?: 'pass' | 'fail'
  totalTests?: number
  passedTests?: number
  failedTests?: number
  errorsBetweenTests?: number
}> = type({
  'endedAt?': isoTimestamp,
  'durationMs?': nonNegativeInt,
  'status?': runStatusSchema,
  'totalTests?': nonNegativeInt,
  'passedTests?': nonNegativeInt,
  'failedTests?': nonNegativeInt,
  'errorsBetweenTests?': nonNegativeInt,
})

/** Fields required to record a single test failure within a run. */
export const insertFailureInputSchema: Type<{
  runId: string
  testFile: string
  testName: string
  failureKind: 'assertion' | 'timeout' | 'uncaught' | 'unknown'
  errorMessage?: string | null
  errorStack?: string | null
  durationMs?: number | null
  failedAt: string
}> = type({
  runId: nonEmptyString,
  testFile: nonEmptyString,
  testName: nonEmptyString,
  failureKind: failureKindSchema,
  'errorMessage?': 'string | null',
  'errorStack?': 'string | null',
  'durationMs?': 'number >= 0 | null',
  failedAt: isoTimestamp,
})

/** A test that has newly become flaky (output from pattern detection). */
export const flakyPatternSchema: Type<{
  testFile: string
  testName: string
  recentFails: number
  priorFails: number
  failureKinds: ('assertion' | 'timeout' | 'uncaught' | 'unknown')[]
  lastErrorMessage: string | null
  lastErrorStack: string | null
  lastFailed: string
}> = type({
  testFile: 'string',
  testName: 'string',
  recentFails: nonNegativeInt,
  priorFails: nonNegativeInt,
  failureKinds: failureKindSchema.array(),
  lastErrorMessage: 'string | null',
  lastErrorStack: 'string | null',
  lastFailed: isoTimestamp,
})

/** Options for querying new flaky patterns. */
export const getNewPatternsOptionsSchema: Type<{
  windowDays?: number
  threshold?: number
  project?: string | null
}> = type({
  'windowDays?': positiveInt,
  'threshold?': positiveInt,
  /** Filter to a single project. Null-or-undefined matches rows whose `project` column is NULL so cross-project stores stay cleanly isolated. */
  'project?': 'string | null',
})

/** Git metadata captured at test-run start. Null fields indicate git is unavailable. */
export const gitInfoSchema: Type<{
  sha: string | null
  dirty: boolean | null
}> = type({
  sha: 'string | null',
  dirty: 'boolean | null',
})
