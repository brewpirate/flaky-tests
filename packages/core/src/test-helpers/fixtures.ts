/**
 * Shared fixture builders for store adapter tests. Keep these identical
 * across every adapter so the contract suite exercises the same shape
 * everywhere — that's the whole point of centralizing them.
 */

import type { FailureKind, InsertFailureInput, InsertRunInput } from '../types'

const MS_PER_DAY = 86_400_000

/** Return a `Date` `n` days before now. Used by contract tests to place
 *  failures inside or outside the recent window. */
export function daysAgo(n: number): Date {
  return new Date(Date.now() - n * MS_PER_DAY)
}

/** Minimal valid `InsertRunInput`: just a runId and a startedAt timestamp. */
export function makeRun(
  runId: string,
  startedAt: Date = new Date(),
): InsertRunInput {
  return {
    runId,
    startedAt: startedAt.toISOString(),
  }
}

/** Minimal valid `InsertFailureInput` for a single test failure. */
export function makeFailure(
  runId: string,
  testName: string,
  failedAt: Date,
  kind: FailureKind = 'assertion',
): InsertFailureInput {
  return {
    runId,
    testFile: 'tests/example.test.ts',
    testName,
    failureKind: kind,
    errorMessage: `${testName} failed`,
    errorStack: null,
    failedAt: failedAt.toISOString(),
  }
}
