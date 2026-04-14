import { describe, expect, test } from 'bun:test'
import { type } from 'arktype'
import {
  failureKindSchema,
  flakyPatternSchema,
  getNewPatternsOptionsSchema,
  gitInfoSchema,
  insertFailureInputSchema,
  insertRunInputSchema,
  updateRunInputSchema,
} from './schemas'

const validTimestamp = '2024-06-15T10:30:00.000Z'

function isError(result: unknown): boolean {
  return result instanceof type.errors
}

// ---------------------------------------------------------------------------
// failureKindSchema
// ---------------------------------------------------------------------------

describe('failureKindSchema', () => {
  test('accepts valid kinds', () => {
    for (const kind of ['assertion', 'timeout', 'uncaught', 'unknown']) {
      expect(isError(failureKindSchema(kind))).toBe(false)
    }
  })

  test('rejects invalid kind', () => {
    expect(isError(failureKindSchema('crash'))).toBe(true)
  })

  test('rejects non-string', () => {
    expect(isError(failureKindSchema(42))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// insertRunInputSchema
// ---------------------------------------------------------------------------

describe('insertRunInputSchema', () => {
  const validInput = {
    runId: 'run-123',
    startedAt: validTimestamp,
  }

  test('accepts valid input with required fields only', () => {
    expect(isError(insertRunInputSchema(validInput))).toBe(false)
  })

  test('accepts valid input with all optional fields', () => {
    const result = insertRunInputSchema({
      ...validInput,
      gitSha: 'abc123',
      gitDirty: true,
      runtimeVersion: '1.3.0',
      testArgs: '--filter auth',
    })
    expect(isError(result)).toBe(false)
  })

  test('accepts null for optional fields', () => {
    const result = insertRunInputSchema({
      ...validInput,
      gitSha: null,
      gitDirty: null,
      runtimeVersion: null,
      testArgs: null,
    })
    expect(isError(result)).toBe(false)
  })

  test('rejects empty runId', () => {
    expect(isError(insertRunInputSchema({ ...validInput, runId: '' }))).toBe(
      true,
    )
  })

  test('rejects invalid timestamp', () => {
    expect(
      isError(insertRunInputSchema({ ...validInput, startedAt: 'not-a-date' })),
    ).toBe(true)
  })

  test('rejects missing runId', () => {
    expect(isError(insertRunInputSchema({ startedAt: validTimestamp }))).toBe(
      true,
    )
  })

  test('rejects timestamp without Z suffix', () => {
    expect(
      isError(
        insertRunInputSchema({
          ...validInput,
          startedAt: '2024-06-15T10:30:00+00:00',
        }),
      ),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// updateRunInputSchema
// ---------------------------------------------------------------------------

describe('updateRunInputSchema', () => {
  test('accepts empty object (all fields optional)', () => {
    expect(isError(updateRunInputSchema({}))).toBe(false)
  })

  test('accepts valid complete input', () => {
    const result = updateRunInputSchema({
      endedAt: validTimestamp,
      durationMs: 1234,
      status: 'pass',
      totalTests: 50,
      passedTests: 49,
      failedTests: 1,
      errorsBetweenTests: 0,
    })
    expect(isError(result)).toBe(false)
  })

  test('rejects invalid status', () => {
    expect(isError(updateRunInputSchema({ status: 'error' }))).toBe(true)
  })

  test('rejects negative durationMs', () => {
    expect(isError(updateRunInputSchema({ durationMs: -1 }))).toBe(true)
  })

  test('rejects non-integer totalTests', () => {
    expect(isError(updateRunInputSchema({ totalTests: 5.5 }))).toBe(true)
  })

  test('rejects negative failedTests', () => {
    expect(isError(updateRunInputSchema({ failedTests: -3 }))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// insertFailureInputSchema
// ---------------------------------------------------------------------------

describe('insertFailureInputSchema', () => {
  const validFailure = {
    runId: 'run-1',
    testFile: 'tests/auth.test.ts',
    testName: 'auth > login',
    failureKind: 'assertion' as const,
    failedAt: validTimestamp,
  }

  test('accepts valid input with required fields', () => {
    expect(isError(insertFailureInputSchema(validFailure))).toBe(false)
  })

  test('accepts valid input with all fields', () => {
    const result = insertFailureInputSchema({
      ...validFailure,
      errorMessage: 'Expected true to be false',
      errorStack: 'Error: ...\n  at ...',
      durationMs: 123.456,
    })
    expect(isError(result)).toBe(false)
  })

  test('accepts null optional fields', () => {
    const result = insertFailureInputSchema({
      ...validFailure,
      errorMessage: null,
      errorStack: null,
      durationMs: null,
    })
    expect(isError(result)).toBe(false)
  })

  test('rejects invalid failureKind', () => {
    expect(
      isError(
        insertFailureInputSchema({ ...validFailure, failureKind: 'crash' }),
      ),
    ).toBe(true)
  })

  test('rejects empty testFile', () => {
    expect(
      isError(insertFailureInputSchema({ ...validFailure, testFile: '' })),
    ).toBe(true)
  })

  test('rejects negative durationMs', () => {
    expect(
      isError(insertFailureInputSchema({ ...validFailure, durationMs: -1 })),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// flakyPatternSchema
// ---------------------------------------------------------------------------

describe('flakyPatternSchema', () => {
  const validPattern = {
    testFile: 'tests/auth.test.ts',
    testName: 'auth > login',
    recentFails: 3,
    priorFails: 0,
    failureKinds: ['assertion', 'timeout'],
    lastErrorMessage: 'something failed',
    lastErrorStack: null,
    lastFailed: validTimestamp,
  }

  test('accepts valid pattern', () => {
    expect(isError(flakyPatternSchema(validPattern))).toBe(false)
  })

  test('rejects non-integer recentFails', () => {
    expect(
      isError(flakyPatternSchema({ ...validPattern, recentFails: 2.5 })),
    ).toBe(true)
  })

  test('rejects negative priorFails', () => {
    expect(
      isError(flakyPatternSchema({ ...validPattern, priorFails: -1 })),
    ).toBe(true)
  })

  test('rejects invalid lastFailed timestamp', () => {
    expect(
      isError(flakyPatternSchema({ ...validPattern, lastFailed: 'bad' })),
    ).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// getNewPatternsOptionsSchema
// ---------------------------------------------------------------------------

describe('getNewPatternsOptionsSchema', () => {
  test('accepts empty object (all optional)', () => {
    expect(isError(getNewPatternsOptionsSchema({}))).toBe(false)
  })

  test('accepts valid options', () => {
    expect(
      isError(getNewPatternsOptionsSchema({ windowDays: 14, threshold: 3 })),
    ).toBe(false)
  })

  test('rejects zero windowDays', () => {
    expect(isError(getNewPatternsOptionsSchema({ windowDays: 0 }))).toBe(true)
  })

  test('rejects negative threshold', () => {
    expect(isError(getNewPatternsOptionsSchema({ threshold: -1 }))).toBe(true)
  })

  test('rejects non-integer windowDays', () => {
    expect(isError(getNewPatternsOptionsSchema({ windowDays: 7.5 }))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// gitInfoSchema
// ---------------------------------------------------------------------------

describe('gitInfoSchema', () => {
  test('accepts valid git info', () => {
    expect(isError(gitInfoSchema({ sha: 'abc123', dirty: true }))).toBe(false)
  })

  test('accepts null fields (git unavailable)', () => {
    expect(isError(gitInfoSchema({ sha: null, dirty: null }))).toBe(false)
  })

  test('rejects missing sha', () => {
    expect(isError(gitInfoSchema({ dirty: false }))).toBe(true)
  })

  test('rejects non-boolean dirty', () => {
    expect(isError(gitInfoSchema({ sha: 'abc', dirty: 'yes' }))).toBe(true)
  })
})
