import { type } from 'arktype'

// ---------------------------------------------------------------------------
// Reusable constraints
// ---------------------------------------------------------------------------

const isoTimestamp = type('string').narrow((value, ctx) =>
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)
    || ctx.reject({ expected: 'an ISO 8601 timestamp (YYYY-MM-DDTHH:mm:ss.sssZ)' }),
)

const nonEmptyString = type.string.atLeastLength(1)
const nonNegativeInt = type('number.integer >= 0')
const positiveInt = type('number.integer > 0')

// ---------------------------------------------------------------------------
// Domain schemas
// ---------------------------------------------------------------------------

/** Coarse classification of why a test failed. */
export const failureKindSchema = type("'assertion' | 'timeout' | 'uncaught' | 'unknown'")

/** Terminal status of a completed test run. */
export const runStatusSchema = type("'pass' | 'fail'")

/** Fields required to record a new test run. */
export const insertRunInputSchema = type({
  runId: nonEmptyString,
  startedAt: isoTimestamp,
  'gitSha?': 'string | null',
  'gitDirty?': 'boolean | null',
  'runtimeVersion?': 'string | null',
  'testArgs?': 'string | null',
})

/** Partial fields for updating a run after it completes. */
export const updateRunInputSchema = type({
  'endedAt?': isoTimestamp,
  'durationMs?': nonNegativeInt,
  'status?': runStatusSchema,
  'totalTests?': nonNegativeInt,
  'passedTests?': nonNegativeInt,
  'failedTests?': nonNegativeInt,
  'errorsBetweenTests?': nonNegativeInt,
})

/** Fields required to record a single test failure within a run. */
export const insertFailureInputSchema = type({
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
export const flakyPatternSchema = type({
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
export const getNewPatternsOptionsSchema = type({
  'windowDays?': positiveInt,
  'threshold?': positiveInt,
})

/** Git metadata captured at test-run start. Null fields indicate git is unavailable. */
export const gitInfoSchema = type({
  sha: 'string | null',
  dirty: 'boolean | null',
})
