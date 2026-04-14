import { mkdirSync } from 'node:fs'
import { Database } from 'bun:sqlite'
import type {
  FlakyPattern,
  GetNewPatternsOptions,
  InsertFailureInput,
  InsertRunInput,
  IStore,
  UpdateRunInput,
} from '@flaky-tests/core'

export interface SqliteStoreOptions {
  /** Path to the SQLite database file. Defaults to node_modules/.cache/flaky-tests/failures.db */
  dbPath?: string
}

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

export class SqliteStore implements IStore {
  private db: Database

  constructor(options: SqliteStoreOptions = {}) {
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

  async insertRun(input: InsertRunInput): Promise<void> {
    this.db.run(
      `INSERT INTO runs (run_id, started_at, git_sha, git_dirty, runtime_version, test_args)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.runId,
        input.startedAt,
        input.gitSha ?? null,
        input.gitDirty != null ? (input.gitDirty ? 1 : 0) : null,
        input.runtimeVersion ?? null,
        input.testArgs ?? null,
      ],
    )
  }

  async updateRun(runId: string, input: UpdateRunInput): Promise<void> {
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

  async insertFailure(input: InsertFailureInput): Promise<void> {
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
    console.warn(
      `[flaky-tests] Run ${runId} exited with failure but preload recorded status=pass. Overriding to fail.`,
    )
  }

  async getNewPatterns(options: GetNewPatternsOptions = {}): Promise<FlakyPattern[]> {
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
      .all(windowStart, windowStart, priorStart, windowStart, windowStart, priorStart, threshold)

    return rows.map((r) => ({
      testFile: r.test_file,
      testName: r.test_name,
      recentFails: r.recent_fails,
      priorFails: r.prior_fails,
      failureKinds: r.failure_kinds.split(','),
      lastErrorMessage: r.last_error_message_raw != null ? r.last_error_message_raw.slice(TS_LEN) : null,
      lastErrorStack: r.last_error_stack_raw != null ? r.last_error_stack_raw.slice(TS_LEN) : null,
      lastFailed: r.last_failed,
    }))
  }

  async close(): Promise<void> {
    this.db.close()
  }

  /** Expose the raw Database for advanced use (e.g. report generation). */
  getDb(): Database {
    return this.db
  }
}
