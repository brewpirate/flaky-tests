import type {
  FlakyPattern,
  GetFailureKindBreakdownOptions,
  GetHotFilesOptions,
  GetNewPatternsOptions,
  GetRecentRunsOptions,
  HotFile,
  InsertFailureInput,
  InsertRunInput,
  IStore,
  KindBreakdown,
  RecentRun,
  UpdateRunInput,
} from '@flaky-tests/core'
import {
  coerceFailureKind,
  coerceFailureKinds,
  coerceRunStatus,
  GetFailureKindBreakdownOptionsSchema,
  GetHotFilesOptionsSchema,
  GetNewPatternsOptionsSchema,
  GetRecentRunsOptionsSchema,
  InsertFailureInputSchema,
  InsertRunInputSchema,
  UpdateRunInputSchema,
  validateInput,
} from '@flaky-tests/core'
import type { Client, InArgs } from '@libsql/client'
import { createClient } from '@libsql/client'

function gitDirtyToSqlite(gitDirty: boolean | null | undefined): 0 | 1 | null {
  if (gitDirty == null) return null
  return gitDirty ? 1 : 0
}

/**
 * Configuration for the Turso-backed flaky-tests store. Accepts any libsql
 * client URL so the same store works against a remote Turso database, a
 * local libsql file, or an in-memory database for tests.
 */
export interface TursoStoreOptions {
  /**
   * Turso database URL.
   * - Remote:    libsql://your-db.turso.io
   * - Local dev: file:///path/to/local.db  or  :memory:
   */
  url: string
  /** Turso auth token. Not required for local file/memory URLs. */
  authToken?: string
}

// Schema is identical to store-sqlite — Turso is SQLite-compatible.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  run_id                TEXT PRIMARY KEY,
  started_at            TEXT NOT NULL,
  ended_at              TEXT,
  duration_ms           INTEGER,
  status                TEXT,
  total_tests           INTEGER,
  passed_tests          INTEGER,
  failed_tests          INTEGER,
  errors_between_tests  INTEGER,
  git_sha               TEXT,
  git_dirty             INTEGER,
  runtime_version       TEXT,
  test_args             TEXT
);

CREATE TABLE IF NOT EXISTS failures (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         TEXT NOT NULL REFERENCES runs(run_id),
  test_file      TEXT NOT NULL,
  test_name      TEXT NOT NULL,
  failure_kind   TEXT NOT NULL,
  error_message  TEXT,
  error_stack    TEXT,
  duration_ms    INTEGER,
  failed_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_failures_test ON failures(test_file, test_name);
CREATE INDEX IF NOT EXISTS idx_failures_run  ON failures(run_id);
`

/**
 * Flaky-test store backed by Turso (libSQL). Wire-compatible with
 * the SQLite store — swap the connection URL to go local or remote.
 */
export class TursoStore implements IStore {
  private client: Client

  constructor(options: TursoStoreOptions) {
    this.client = createClient({
      url: options.url,
      ...(options.authToken !== undefined
        ? { authToken: options.authToken }
        : {}),
    })
  }

  /** Create tables if they don't exist. Call once before first use. */
  async migrate(): Promise<void> {
    for (const stmt of SCHEMA.trim()
      .split(';')
      .filter((s) => s.trim())) {
      await this.client.execute(stmt)
    }
    // Idempotent column additions for older DBs
    const migrations = [
      'ALTER TABLE runs ADD COLUMN passed_tests INTEGER',
      'ALTER TABLE runs ADD COLUMN errors_between_tests INTEGER',
      'ALTER TABLE runs ADD COLUMN runtime_version TEXT',
      'ALTER TABLE runs ADD COLUMN test_args TEXT',
    ]
    for (const stmt of migrations) {
      try {
        await this.client.execute(stmt)
      } catch {
        // Column already present
      }
    }
  }

  /** Persist a new test-run row. Call before any failures are recorded. */
  async insertRun(rawInput: InsertRunInput): Promise<void> {
    const input = validateInput(InsertRunInputSchema, rawInput, 'insertRun')
    await this.client.execute({
      sql: `INSERT INTO runs (run_id, started_at, git_sha, git_dirty, runtime_version, test_args)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        input.runId,
        input.startedAt,
        input.gitSha ?? null,
        gitDirtyToSqlite(input.gitDirty),
        input.runtimeVersion ?? null,
        input.testArgs ?? null,
      ] as InArgs,
    })
  }

  /** Update a run with its final summary (status, counts, duration). */
  async updateRun(runId: string, rawInput: UpdateRunInput): Promise<void> {
    const input = validateInput(UpdateRunInputSchema, rawInput, 'updateRun')
    await this.client.execute({
      sql: `UPDATE runs
               SET ended_at             = ?,
                   duration_ms          = ?,
                   status               = ?,
                   total_tests          = ?,
                   passed_tests         = ?,
                   failed_tests         = ?,
                   errors_between_tests = ?
             WHERE run_id = ?`,
      args: [
        input.endedAt ?? null,
        input.durationMs ?? null,
        input.status ?? null,
        input.totalTests ?? null,
        input.passedTests ?? null,
        input.failedTests ?? null,
        input.errorsBetweenTests ?? null,
        runId,
      ] as InArgs,
    })
  }

  /** Record a single test failure linked to an existing run. */
  async insertFailure(rawInput: InsertFailureInput): Promise<void> {
    const input = validateInput(
      InsertFailureInputSchema,
      rawInput,
      'insertFailure',
    )
    await this.client.execute({
      sql: `INSERT INTO failures
              (run_id, test_file, test_name, failure_kind,
               error_message, error_stack, duration_ms, failed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        input.runId,
        input.testFile,
        input.testName,
        input.failureKind,
        input.errorMessage ?? null,
        input.errorStack ?? null,
        input.durationMs != null ? Math.round(input.durationMs) : null,
        input.failedAt,
      ] as InArgs,
    })
  }

  /**
   * Detect newly-flaky tests: tests that failed >= `threshold` times in the
   * recent window but had zero failures in the prior window of equal length.
   * Only considers runs where fewer than 10 tests failed (filters out broken builds).
   *
   * @param options.windowDays - Length of the recent window (default 7).
   * @param options.threshold  - Minimum recent failures to qualify (default 2).
   * @returns Patterns sorted by recent failure count descending.
   */
  async getNewPatterns(
    rawOptions: GetNewPatternsOptions = {},
  ): Promise<FlakyPattern[]> {
    const options = validateInput(
      GetNewPatternsOptionsSchema,
      rawOptions,
      'getNewPatterns',
    )
    const windowDays = options.windowDays ?? 7
    const threshold = options.threshold ?? 2
    const now = Date.now()
    const windowStart = new Date(now - windowDays * 86400000).toISOString()
    const priorStart = new Date(now - windowDays * 2 * 86400000).toISOString()

    // Identical query to store-sqlite — Turso speaks SQLite
    const result = await this.client.execute({
      sql: `SELECT
               f.test_file,
               f.test_name,
               SUM(CASE WHEN f.failed_at > ?  THEN 1 ELSE 0 END) AS recent_fails,
               SUM(CASE WHEN f.failed_at <= ? AND f.failed_at > ? THEN 1 ELSE 0 END) AS prior_fails,
               GROUP_CONCAT(DISTINCT f.failure_kind) AS failure_kinds,
               MAX(CASE WHEN f.failed_at > ? THEN f.error_message END) AS last_error_message,
               MAX(CASE WHEN f.failed_at > ? THEN f.error_stack   END) AS last_error_stack,
               MAX(f.failed_at) AS last_failed
             FROM failures f
             JOIN runs r ON r.run_id = f.run_id
            WHERE r.failed_tests < 10
              AND r.ended_at IS NOT NULL
              AND f.failed_at > ?
            GROUP BY f.test_file, f.test_name
            HAVING recent_fails >= ? AND prior_fails = 0
            ORDER BY recent_fails DESC`,
      args: [
        windowStart,
        windowStart,
        priorStart,
        windowStart,
        windowStart,
        priorStart,
        threshold,
      ] as InArgs,
    })

    return result.rows.map((r) => ({
      testFile: String(r.test_file),
      testName: String(r.test_name),
      recentFails: Number(r.recent_fails),
      priorFails: Number(r.prior_fails),
      failureKinds: coerceFailureKinds(String(r.failure_kinds)),
      lastErrorMessage:
        r.last_error_message != null ? String(r.last_error_message) : null,
      lastErrorStack:
        r.last_error_stack != null ? String(r.last_error_stack) : null,
      lastFailed: String(r.last_failed),
    }))
  }

  /** Return recent test runs, newest first. */
  async getRecentRuns(
    rawOptions: GetRecentRunsOptions = {},
  ): Promise<RecentRun[]> {
    const options = validateInput(
      GetRecentRunsOptionsSchema,
      rawOptions,
      'getRecentRuns',
    )
    const limit = options.limit ?? 20
    const result = await this.client.execute({
      sql: `SELECT run_id, started_at, ended_at, duration_ms, status,
                   total_tests, passed_tests, failed_tests,
                   errors_between_tests, git_sha, git_dirty
              FROM runs
             ORDER BY started_at DESC
             LIMIT ?`,
      args: [limit] as InArgs,
    })
    return result.rows.map((r) => ({
      runId: String(r.run_id),
      startedAt: String(r.started_at),
      endedAt: r.ended_at != null ? String(r.ended_at) : null,
      durationMs: r.duration_ms != null ? Number(r.duration_ms) : null,
      status: coerceRunStatus(r.status),
      totalTests: r.total_tests != null ? Number(r.total_tests) : null,
      passedTests: r.passed_tests != null ? Number(r.passed_tests) : null,
      failedTests: r.failed_tests != null ? Number(r.failed_tests) : null,
      errorsBetweenTests:
        r.errors_between_tests != null ? Number(r.errors_between_tests) : null,
      gitSha: r.git_sha != null ? String(r.git_sha) : null,
      gitDirty: r.git_dirty != null ? Boolean(Number(r.git_dirty)) : null,
    }))
  }

  /** Breakdown of failure kinds within a time window. */
  async getFailureKindBreakdown(
    rawOptions: GetFailureKindBreakdownOptions = {},
  ): Promise<KindBreakdown[]> {
    const options = validateInput(
      GetFailureKindBreakdownOptionsSchema,
      rawOptions,
      'getFailureKindBreakdown',
    )
    const windowDays = options.windowDays ?? 30
    const result = await this.client.execute({
      sql: `SELECT failure_kind, COUNT(*) AS count
              FROM failures
             WHERE failed_at > datetime('now', '-' || ? || ' days')
             GROUP BY failure_kind`,
      args: [windowDays] as InArgs,
    })
    return result.rows.map((r) => ({
      failureKind: coerceFailureKind(r.failure_kind),
      count: Number(r.count),
    }))
  }

  /** Files with the most failures in a time window. */
  async getHotFiles(rawOptions: GetHotFilesOptions = {}): Promise<HotFile[]> {
    const options = validateInput(
      GetHotFilesOptionsSchema,
      rawOptions,
      'getHotFiles',
    )
    const windowDays = options.windowDays ?? 30
    const limit = options.limit ?? 15
    const result = await this.client.execute({
      sql: `SELECT test_file,
                   COUNT(*) AS fails,
                   COUNT(DISTINCT test_name) AS distinct_tests
              FROM failures
             WHERE failed_at > datetime('now', '-' || ? || ' days')
             GROUP BY test_file
             ORDER BY fails DESC
             LIMIT ?`,
      args: [windowDays, limit] as InArgs,
    })
    return result.rows.map((r) => ({
      testFile: String(r.test_file),
      fails: Number(r.fails),
      distinctTests: Number(r.distinct_tests),
    }))
  }

  /** Close the underlying libSQL connection. */
  async close(): Promise<void> {
    this.client.close()
  }
}
