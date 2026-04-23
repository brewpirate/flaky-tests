import {
  insertFailureInputSchema,
  insertRunInputSchema,
  updateRunInputSchema,
} from '#core/schema/schemas'
import { parse } from '#core/schema/validate-schemas'
import type {
  GitInfo,
  InsertFailureInput,
  InsertRunInput,
  UpdateRunInput,
} from '#core/types'
import { categorizeError, extractMessage, extractStack } from './categorize'

/** Options for {@link buildInsertRunInput}. */
export interface BuildInsertRunInputOpts {
  /** Identifier for the run about to start. */
  runId: string
  /** Runtime version string — e.g. `Bun.version`, `process.version`. */
  runtimeVersion: string
  /** Git metadata captured at run start (see {@link captureGitInfo}). */
  git: GitInfo
  /**
   * Project label scoping the run. Defaults to `null` so adapters' NULL-
   * vs-value filter behaves consistently.
   */
  project?: string | null
  /**
   * Run start timestamp as an ISO string. Defaults to `new Date().toISOString()`;
   * callers pass an explicit value when they need to tie it to an earlier
   * `performance.now()` sample.
   */
  startedAt?: string
  /**
   * Raw CLI args for this test invocation. Defaults to
   * `process.argv.slice(2).join(' ')` — the same shape both plugins were
   * reconstructing individually.
   */
  testArgs?: string
}

/**
 * Build a validated {@link InsertRunInput} for the "test run is starting"
 * write. Centralises the shape both plugin-bun and plugin-vitest were
 * hand-rolling, including the `process.argv` reconstruction and the
 * git-info/project fallbacks.
 */
export function buildInsertRunInput(
  opts: BuildInsertRunInputOpts,
): InsertRunInput {
  const {
    runId,
    runtimeVersion,
    git,
    project = null,
    startedAt = new Date().toISOString(),
    testArgs = process.argv.slice(2).join(' '),
  } = opts
  return parse(insertRunInputSchema, {
    runId,
    project,
    startedAt,
    gitSha: git.sha,
    gitDirty: git.dirty,
    runtimeVersion,
    testArgs,
  })
}

/** Options for {@link buildInsertFailureInput}. */
export interface BuildInsertFailureInputOpts {
  runId: string
  testFile: string
  testName: string
  /** The thrown value — coerced through the core error helpers for kind/message/stack. */
  error: unknown
  /** Observed duration for the failing test. `null` when the framework doesn't report one. */
  durationMs: number | null
  /** Failure timestamp. Defaults to `new Date().toISOString()`. */
  failedAt?: string
}

/**
 * Build a validated {@link InsertFailureInput} for a single failure event.
 * Runs the thrown value through {@link categorizeError}, {@link extractMessage},
 * and {@link extractStack} so both plugins produce the same columns.
 */
export function buildInsertFailureInput(
  opts: BuildInsertFailureInputOpts,
): InsertFailureInput {
  const {
    runId,
    testFile,
    testName,
    error,
    durationMs,
    failedAt = new Date().toISOString(),
  } = opts
  return parse(insertFailureInputSchema, {
    runId,
    testFile,
    testName,
    failureKind: categorizeError(error),
    errorMessage: error == null ? null : extractMessage(error),
    errorStack: error == null ? null : extractStack(error),
    durationMs: durationMs == null ? null : Math.round(durationMs),
    failedAt,
  })
}

/** Options for {@link buildUpdateRunInput}. */
export interface BuildUpdateRunInputOpts {
  totalTests: number
  passedTests: number
  failedTests: number
  errorsBetweenTests: number
  durationMs: number
  /** Run end timestamp. Defaults to `new Date().toISOString()`. */
  endedAt?: string
}

/**
 * Build a validated {@link UpdateRunInput} for the "test run finished"
 * write. Derives `status` — `fail` when any test failed or any
 * between-tests error fired, `pass` otherwise — so both plugins arrive at
 * the same rule.
 */
export function buildUpdateRunInput(
  opts: BuildUpdateRunInputOpts,
): UpdateRunInput {
  const {
    totalTests,
    passedTests,
    failedTests,
    errorsBetweenTests,
    durationMs,
    endedAt = new Date().toISOString(),
  } = opts
  const status: 'pass' | 'fail' =
    failedTests > 0 || errorsBetweenTests > 0 ? 'fail' : 'pass'
  return parse(updateRunInputSchema, {
    endedAt,
    durationMs,
    status,
    totalTests,
    passedTests,
    failedTests,
    errorsBetweenTests,
  })
}
