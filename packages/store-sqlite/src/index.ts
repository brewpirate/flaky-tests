import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
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
import { z } from 'zod'

/**
 * Zod schema for {@link SqliteStoreOptions}. Exported so callers can validate
 * untrusted config (JSON file, env-driven options) before constructing a store.
 */
export const SqliteStoreOptionsSchema = z.object({
  /** Path to the SQLite database file. Defaults to node_modules/.cache/flaky-tests/failures.db */
  dbPath: z.string().min(1).max(4096).optional(),
})

/** Configuration for the SQLite-backed flaky-tests store. */
export type SqliteStoreOptions = z.infer<typeof SqliteStoreOptionsSchema>

const DEFAULT_DB_PATH = 'node_modules/.cache/flaky-tests/failures.db'

function gitDirtyToSqlite(gitDirty: boolean | null | undefined): 0 | 1 | null {
  if (gitDirty == null) return null
  return gitDirty ? 1 : 0
}

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

function ensureDirectory(dbPath: string): void {
  const lastSlash = dbPath.lastIndexOf('/')
  if (lastSlash <= 0) return
  const parent = dbPath.slice(0, lastSlash)
  try {
    mkdirSync(parent, { recursive: true })
  } catch {
    // Directory already exists or cannot be created; let Database attempt anyway.
  }
}

/**
 * SQLite-backed implementation of the flaky-tests {@link IStore} interface.
 *
 * Creates the database file and schema on construction. Uses WAL journal mode
 * for concurrent read performance and applies forward-compatible migrations.
 */
export class SqliteStore implements IStore {
  private db: Database

  /**
   * Open (or create) a SQLite store.
   * @param options - Store configuration; uses sensible defaults when omitted.
   */
  constructor(rawOptions: SqliteStoreOptions = {}) {
    const options = validateInput(
      SqliteStoreOptionsSchema,
      rawOptions,
      'SqliteStore',
    )
    const dbPath = options.dbPath ?? DEFAULT_DB_PATH
    ensureDirectory(dbPath)
    this.db = new Database(dbPath, { create: true })
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(SCHEMA)
    this.migrate()
  }

  /**
   * Idempotent column adds for databases created before schema updates.
   * SQLite lacks `ADD COLUMN IF NOT EXISTS`, so each ALTER throws when the
   * column already exists — we catch and ignore.
   */
  private migrate(): void {
    const migrations = [
      'ALTER TABLE runs ADD COLUMN passed_tests INTEGER',
      'ALTER TABLE runs ADD COLUMN errors_between_tests INTEGER',
      'ALTER TABLE runs ADD COLUMN runtime_version TEXT',
      'ALTER TABLE runs ADD COLUMN test_args TEXT',
    ]
    for (const stmt of migrations) {
      try {
        this.db.exec(stmt)
      } catch {
        // Column already present.
      }
    }
  }

  /**
   * Record a new test run. Called at the start of a test session.
   * @param input - Run metadata including ID, timestamp, and optional git info.
   */
  async insertRun(rawInput: InsertRunInput): Promise<void> {
    const input = validateInput(InsertRunInputSchema, rawInput, 'insertRun')
    this.db.run(
      `INSERT INTO runs (run_id, started_at, git_sha, git_dirty, runtime_version, test_args)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.runId,
        input.startedAt,
        input.gitSha ?? null,
        gitDirtyToSqlite(input.gitDirty),
        input.runtimeVersion ?? null,
        input.testArgs ?? null,
      ],
    )
  }

  /**
   * Finalize a run with end-of-session stats (duration, pass/fail counts, status).
   * @param runId - The run to update.
   * @param input - Completion data for the run.
   */
  async updateRun(runId: string, rawInput: UpdateRunInput): Promise<void> {
    const input = validateInput(UpdateRunInputSchema, rawInput, 'updateRun')
    this.db.run(
      `UPDATE runs
          SET ended_at             = ?,
              duration_ms          = ?,
              status               = ?,
              total_tests          = ?,
              passed_tests         = ?,
              failed_tests         = ?,
              errors_between_tests = ?
        WHERE run_id = ?`,
      [
        input.endedAt ?? null,
        input.durationMs ?? null,
        input.status ?? null,
        input.totalTests ?? null,
        input.passedTests ?? null,
        input.failedTests ?? null,
        input.errorsBetweenTests ?? null,
        runId,
      ],
    )
  }

  /**
   * Record an individual test failure within a run.
   * @param input - Failure details including test identity, error info, and timing.
   */
  async insertFailure(rawInput: InsertFailureInput): Promise<void> {
    const input = validateInput(
      InsertFailureInputSchema,
      rawInput,
      'insertFailure',
    )
    this.db.run(
      `INSERT INTO failures
         (run_id, test_file, test_name, failure_kind, error_message, error_stack, duration_ms, failed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.runId,
        input.testFile,
        input.testName,
        input.failureKind,
        input.errorMessage ?? null,
        input.errorStack ?? null,
        input.durationMs != null ? Math.round(input.durationMs) : null,
        input.failedAt,
      ],
    )
  }

  /**
   * Reconcile a run's status against the real process exit code.
   * Called by `run-tracked` when `bun test` exits non-zero but the preload
   * recorded status='pass' (e.g. module-load errors bypassed the preload).
   */
  reconcileRun(runId: string): void {
    const row = this.db
      .query('SELECT status FROM runs WHERE run_id = ?')
      .get(runId) as { status: string | null } | null

    if (row === null || row.status !== 'pass') return

    this.db.run(
      `UPDATE runs
          SET status               = 'fail',
              errors_between_tests = COALESCE(errors_between_tests, 0) + 1
        WHERE run_id = ?`,
      [runId],
    )
    // biome-ignore lint/suspicious/noConsole: store runs inside the user's test process where no logger is available; this is a data-integrity warning users need to see.
    console.warn(
      `[flaky-tests] Run ${runId} exited with failure but preload recorded status=pass. Overriding to fail.`,
    )
  }

  /**
   * Detect newly-flaky tests by comparing recent failures against a prior window.
   *
   * Returns tests that failed at least {@link GetNewPatternsOptions.threshold | threshold}
   * times in the recent window but zero times in the prior window of equal length.
   * Runs with >= 10 failures are excluded to filter out infrastructure blowups.
   *
   * @param options - Window size and threshold overrides.
   * @returns Flaky patterns sorted by recent failure count descending.
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

    // ISO 8601 timestamps from .toISOString() are always 24 chars and sort
    // lexicographically. Prefixing values with the timestamp lets MAX() select
    // the most-recent row's payload; we strip the 25-char prefix (24 + separator)
    // afterward. CHAR(1) is a control character that won't appear in messages.
    const TS_LEN = 25 // 24-char timestamp + CHAR(1) separator

    type Row = {
      test_file: string
      test_name: string
      recent_fails: number
      prior_fails: number
      failure_kinds: string
      last_error_message_raw: string | null
      last_error_stack_raw: string | null
      last_failed: string
    }

    const rows = this.db
      .query<Row, [string, string, string, string, string, string, number]>(
        `SELECT
           f.test_file,
           f.test_name,
           SUM(CASE WHEN f.failed_at > ?  THEN 1 ELSE 0 END) AS recent_fails,
           SUM(CASE WHEN f.failed_at <= ? AND f.failed_at > ? THEN 1 ELSE 0 END) AS prior_fails,
           GROUP_CONCAT(DISTINCT f.failure_kind) AS failure_kinds,
           MAX(CASE WHEN f.failed_at > ? AND f.error_message IS NOT NULL
                    THEN f.failed_at || CHAR(1) || f.error_message END) AS last_error_message_raw,
           MAX(CASE WHEN f.failed_at > ? AND f.error_stack IS NOT NULL
                    THEN f.failed_at || CHAR(1) || f.error_stack   END) AS last_error_stack_raw,
           MAX(f.failed_at) AS last_failed
         FROM failures f
         JOIN runs r ON r.run_id = f.run_id
        WHERE r.failed_tests < 10
          AND r.ended_at IS NOT NULL
          AND f.failed_at > ?
        GROUP BY f.test_file, f.test_name
        HAVING recent_fails >= ? AND prior_fails = 0
        ORDER BY recent_fails DESC`,
      )
      .all(
        windowStart,
        windowStart,
        priorStart,
        windowStart,
        windowStart,
        priorStart,
        threshold,
      )

    return rows.map((r) => ({
      testFile: r.test_file,
      testName: r.test_name,
      recentFails: r.recent_fails,
      priorFails: r.prior_fails,
      failureKinds: coerceFailureKinds(r.failure_kinds),
      lastErrorMessage:
        r.last_error_message_raw != null
          ? r.last_error_message_raw.slice(TS_LEN)
          : null,
      lastErrorStack:
        r.last_error_stack_raw != null
          ? r.last_error_stack_raw.slice(TS_LEN)
          : null,
      lastFailed: r.last_failed,
    }))
  }

  async getRecentRuns(
    rawOptions: GetRecentRunsOptions = {},
  ): Promise<RecentRun[]> {
    const options = validateInput(
      GetRecentRunsOptionsSchema,
      rawOptions,
      'getRecentRuns',
    )
    const limit = options.limit ?? 20
    interface RunRow {
      run_id: string
      started_at: string
      ended_at: string | null
      duration_ms: number | null
      status: string | null
      total_tests: number | null
      passed_tests: number | null
      failed_tests: number | null
      errors_between_tests: number | null
      git_sha: string | null
      git_dirty: number | null
    }
    const rows = this.db
      .query<RunRow, [number]>(
        `SELECT run_id, started_at, ended_at, duration_ms, status, total_tests, passed_tests, failed_tests, errors_between_tests, git_sha, git_dirty FROM runs ORDER BY started_at DESC LIMIT ?`,
      )
      .all(limit)

    return rows.map((row) => ({
      runId: row.run_id,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationMs: row.duration_ms,
      status: coerceRunStatus(row.status),
      totalTests: row.total_tests,
      passedTests: row.passed_tests,
      failedTests: row.failed_tests,
      errorsBetweenTests: row.errors_between_tests,
      gitSha: row.git_sha,
      gitDirty: row.git_dirty != null ? row.git_dirty === 1 : null,
    }))
  }

  async getFailureKindBreakdown(
    rawOptions: GetFailureKindBreakdownOptions = {},
  ): Promise<KindBreakdown[]> {
    const options = validateInput(
      GetFailureKindBreakdownOptionsSchema,
      rawOptions,
      'getFailureKindBreakdown',
    )
    const windowDays = options.windowDays ?? 30
    interface KindRow {
      failure_kind: string
      count: number
    }
    const rows = this.db
      .query<KindRow, []>(
        `SELECT failure_kind, COUNT(*) AS count FROM failures WHERE failed_at > datetime('now', '-${windowDays} days') GROUP BY failure_kind ORDER BY count DESC`,
      )
      .all()

    return rows.map((row) => ({
      failureKind: coerceFailureKind(row.failure_kind),
      count: row.count,
    }))
  }

  async getHotFiles(rawOptions: GetHotFilesOptions = {}): Promise<HotFile[]> {
    const options = validateInput(
      GetHotFilesOptionsSchema,
      rawOptions,
      'getHotFiles',
    )
    const windowDays = options.windowDays ?? 30
    const limit = options.limit ?? 15
    interface HotFileRow {
      test_file: string
      fails: number
      distinct_tests: number
    }
    const rows = this.db
      .query<HotFileRow, [number]>(
        `SELECT test_file, COUNT(*) AS fails, COUNT(DISTINCT test_name) AS distinct_tests FROM failures WHERE failed_at > datetime('now', '-${windowDays} days') GROUP BY test_file ORDER BY fails DESC LIMIT ?`,
      )
      .all(limit)

    return rows.map((row) => ({
      testFile: row.test_file,
      fails: row.fails,
      distinctTests: row.distinct_tests,
    }))
  }

  /** Close the underlying SQLite connection. */
  async close(): Promise<void> {
    this.db.close()
  }

  /** Expose the raw Database for advanced use (e.g. report generation). */
  getDb(): Database {
    return this.db
  }
}
