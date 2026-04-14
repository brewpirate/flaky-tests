import { createClient } from '@libsql/client'
import type { Client, InArgs } from '@libsql/client'
import type {
  FlakyPattern,
  GetNewPatternsOptions,
  InsertFailureInput,
  InsertRunInput,
  IStore,
  UpdateRunInput,
} from '@flaky-tests/core'

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

export class TursoStore implements IStore {
  private client: Client

  constructor(options: TursoStoreOptions) {
    this.client = createClient({
      url: options.url,
      authToken: options.authToken,
    })
  }

  /** Create tables if they don't exist. Call once before first use. */
  async migrate(): Promise<void> {
    for (const stmt of SCHEMA.trim().split(';').filter((s) => s.trim())) {
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

  async insertRun(input: InsertRunInput): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO runs (run_id, started_at, git_sha, git_dirty, runtime_version, test_args)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        input.runId,
        input.startedAt,
        input.gitSha ?? null,
        input.gitDirty != null ? (input.gitDirty ? 1 : 0) : null,
        input.runtimeVersion ?? null,
        input.testArgs ?? null,
      ] as InArgs,
    })
  }

  async updateRun(runId: string, input: UpdateRunInput): Promise<void> {
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

  async insertFailure(input: InsertFailureInput): Promise<void> {
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

  async getNewPatterns(options: GetNewPatternsOptions = {}): Promise<FlakyPattern[]> {
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
      args: [windowStart, windowStart, priorStart, windowStart, windowStart, priorStart, threshold] as InArgs,
    })

    return result.rows.map((r) => ({
      testFile: String(r.test_file),
      testName: String(r.test_name),
      recentFails: Number(r.recent_fails),
      priorFails: Number(r.prior_fails),
      failureKinds: String(r.failure_kinds).split(','),
      lastErrorMessage: r.last_error_message != null ? String(r.last_error_message) : null,
      lastErrorStack: r.last_error_stack != null ? String(r.last_error_stack) : null,
      lastFailed: String(r.last_failed),
    }))
  }

  async close(): Promise<void> {
    this.client.close()
  }
}
