import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import {
  DEFAULT_THRESHOLD,
  DEFAULT_WINDOW_DAYS,
  MAX_FAILED_TESTS_PER_RUN,
  MS_PER_DAY,
  type FlakyPattern,
  flakyPatternSchema,
  type GetNewPatternsOptions,
  getNewPatternsOptionsSchema,
  type InsertFailureInput,
  insertFailureInputSchema,
  type InsertRunInput,
  insertRunInputSchema,
  type IStore,
  parse,
  parseArray,
  stripTimestampPrefix,
  type UpdateRunInput,
  updateRunInputSchema,
} from '@flaky-tests/core'
import { type } from 'arktype'

/** Configuration for the SQLite-backed flaky-tests store. */
export const sqliteStoreOptionsSchema = type({
  'dbPath?': 'string',
})

export type SqliteStoreOptions = typeof sqliteStoreOptionsSchema.infer

const DEFAULT_DB_PATH = 'node_modules/.cache/flaky-tests/failures.db'

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

CREATE INDEX IF NOT EXISTS idx_failures_test      ON failures(test_file, test_name);
CREATE INDEX IF NOT EXISTS idx_failures_run       ON failures(run_id);
CREATE INDEX IF NOT EXISTS idx_failures_failed_at ON failures(failed_at);
CREATE INDEX IF NOT EXISTS idx_runs_status        ON runs(ended_at, failed_tests);
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
  constructor(options: SqliteStoreOptions = {}) {
    const validated = parse(sqliteStoreOptionsSchema, options)
    const dbPath = validated.dbPath ?? DEFAULT_DB_PATH
    ensureDirectory(dbPath)
    this.db = new Database(dbPath, { create: true })
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec(SCHEMA)
    this.migrate()
  }

  /**
   * Create tables and run idempotent column additions for older databases.
   * Called automatically in the constructor — safe to call again.
   */
  async migrate(): Promise<void> {
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
  async insertRun(input: InsertRunInput): Promise<void> {
    parse(insertRunInputSchema, input)
    this.db.run(
      `INSERT INTO runs (run_id, started_at, git_sha, git_dirty, runtime_version, test_args)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.runId,
        input.startedAt,
        input.gitSha ?? null,
        input.gitDirty != null ? Number(input.gitDirty) : null,
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
  async updateRun(runId: string, input: UpdateRunInput): Promise<void> {
    parse(updateRunInputSchema, input)
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
  async insertFailure(input: InsertFailureInput): Promise<void> {
    parse(insertFailureInputSchema, input)
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

  /** Insert multiple failures in a single SQLite transaction. */
  async insertFailures(inputs: InsertFailureInput[]): Promise<void> {
    if (inputs.length === 0) return
    this.db.transaction(() => {
      for (const input of inputs) {
        parse(insertFailureInputSchema, input)
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
    })()
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
    // biome-ignore lint/suspicious/noConsole: legitimate runtime warning for operator visibility
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
    options: GetNewPatternsOptions = {},
  ): Promise<FlakyPattern[]> {
    const validated = parse(getNewPatternsOptionsSchema, options)
    const windowDays = validated.windowDays ?? DEFAULT_WINDOW_DAYS
    const threshold = validated.threshold ?? DEFAULT_THRESHOLD
    const now = Date.now()
    const windowStart = new Date(now - windowDays * MS_PER_DAY).toISOString()
    const priorStart = new Date(now - windowDays * 2 * MS_PER_DAY).toISOString()

    // Prefixing values with the timestamp lets MAX() select the most-recent
    // row's payload. CHAR(1) is a control character that won't appear in messages.
    // stripTimestampPrefix() removes the prefix dynamically after the query.

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
        WHERE r.failed_tests < ${MAX_FAILED_TESTS_PER_RUN}
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

    return parseArray(flakyPatternSchema, rows.map((r) => ({
      testFile: r.test_file,
      testName: r.test_name,
      recentFails: r.recent_fails,
      priorFails: r.prior_fails,
      failureKinds: r.failure_kinds.split(','),
      lastErrorMessage:
        r.last_error_message_raw != null
          ? stripTimestampPrefix(r.last_error_message_raw)
          : null,
      lastErrorStack:
        r.last_error_stack_raw != null
          ? stripTimestampPrefix(r.last_error_stack_raw)
          : null,
      lastFailed: r.last_failed,
    })))
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
