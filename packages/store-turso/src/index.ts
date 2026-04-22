import {
  type Config,
  createLogger,
  DEFAULT_THRESHOLD,
  DEFAULT_WINDOW_DAYS,
  definePlugin,
  extractMessage,
  type FlakyPattern,
  flakyPatternSchema,
  type GetNewPatternsOptions,
  getNewPatternsOptionsSchema,
  type InsertFailureInput,
  type InsertRunInput,
  type IStore,
  insertFailureInputSchema,
  insertRunInputSchema,
  MAX_FAILED_TESTS_PER_RUN,
  MS_PER_DAY,
  mapRowToPattern,
  type PatternRow,
  parse,
  parseArray,
  type RecentRun,
  type RunStatus,
  StoreError,
  type UpdateRunInput,
  updateRunInputSchema,
} from '@flaky-tests/core'
import type { Client, InArgs } from '@libsql/client'
import { createClient } from '@libsql/client'
import { type } from 'arktype'

const log = createLogger('store-turso')
const PACKAGE = '@flaky-tests/store-turso'

/** Configuration for the Turso (libSQL) store. */
export const tursoStoreOptionsSchema = type({
  url: type.string.atLeastLength(1),
  'authToken?': 'string',
})

/** Inferred options type for {@link TursoStore}: libSQL URL plus optional HTTP auth token. */
export type TursoStoreOptions = typeof tursoStoreOptionsSchema.infer

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

CREATE INDEX IF NOT EXISTS idx_failures_test      ON failures(test_file, test_name);
CREATE INDEX IF NOT EXISTS idx_failures_run       ON failures(run_id);
CREATE INDEX IF NOT EXISTS idx_failures_failed_at ON failures(failed_at);
CREATE INDEX IF NOT EXISTS idx_runs_status        ON runs(ended_at, failed_tests);
`

/**
 * `IStore` implementation targeting libSQL/Turso over HTTP with bearer-token auth.
 * Mirrors the store-sqlite schema and queries verbatim so local and hosted
 * backends stay interchangeable — only the connection URL differs.
 */
export class TursoStore implements IStore {
  private client: Client

  /** Builds the libSQL client from a validated URL and optional auth token. */
  constructor(options: TursoStoreOptions) {
    const validated = parse(tursoStoreOptionsSchema, options)
    this.client = createClient({
      url: validated.url,
      ...(validated.authToken !== undefined && {
        authToken: validated.authToken,
      }),
    })
  }

  /** Wraps a driver call so any thrown libSQL error becomes a {@link StoreError} with `cause` preserved for stack inspection. */
  private async wrap<T>(method: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      throw new StoreError({
        package: PACKAGE,
        method,
        message: extractMessage(error),
        cause: error,
      })
    }
  }

  /** Create tables if they don't exist. Call once before first use. */
  async migrate(): Promise<void> {
    await this.wrap('migrate', async () => {
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
          // Column already present — swallowed intentionally inside the
          // wrap boundary; migrate() itself still reports other failures.
        }
      }
    })
  }

  /** Persist a new test-run row. Call before any failures are recorded. */
  async insertRun(input: InsertRunInput): Promise<void> {
    parse(insertRunInputSchema, input)
    await this.wrap('insertRun', () =>
      this.client.execute({
        sql: `INSERT INTO runs (run_id, started_at, git_sha, git_dirty, runtime_version, test_args)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          input.runId,
          input.startedAt,
          input.gitSha ?? null,
          input.gitDirty != null ? Number(input.gitDirty) : null,
          input.runtimeVersion ?? null,
          input.testArgs ?? null,
        ] as InArgs,
      }),
    )
  }

  /** Update a run with its final summary (status, counts, duration). */
  async updateRun(runId: string, input: UpdateRunInput): Promise<void> {
    parse(updateRunInputSchema, input)
    await this.wrap('updateRun', () =>
      this.client.execute({
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
      }),
    )
  }

  /** Record a single test failure linked to an existing run. */
  async insertFailure(input: InsertFailureInput): Promise<void> {
    parse(insertFailureInputSchema, input)
    await this.wrap('insertFailure', () =>
      this.client.execute({
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
      }),
    )
  }

  /** Insert multiple failures in a single batch transaction. */
  async insertFailures(inputs: readonly InsertFailureInput[]): Promise<void> {
    if (inputs.length === 0) return
    await this.wrap('insertFailures', () =>
      this.client.batch(
        inputs.map((input) => {
          parse(insertFailureInputSchema, input)
          return {
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
          }
        }),
        'write',
      ),
    )
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
    options: GetNewPatternsOptions = {},
  ): Promise<FlakyPattern[]> {
    const validated = parse(getNewPatternsOptionsSchema, options)
    const windowDays = validated.windowDays ?? DEFAULT_WINDOW_DAYS
    const threshold = validated.threshold ?? DEFAULT_THRESHOLD
    const now = Date.now()
    const windowStart = new Date(now - windowDays * MS_PER_DAY).toISOString()
    const priorStart = new Date(now - windowDays * 2 * MS_PER_DAY).toISOString()

    // Identical query to store-sqlite — Turso speaks SQLite
    const result = await this.wrap('getNewPatterns', () =>
      this.client.execute({
        sql: `SELECT
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
        args: [
          windowStart,
          windowStart,
          priorStart,
          windowStart,
          windowStart,
          priorStart,
          threshold,
        ] as InArgs,
      }),
    )

    // libsql Row type doesn't expose named fields — cast through unknown to PatternRow
    const patterns = parseArray(
      flakyPatternSchema,
      result.rows.map((row) => mapRowToPattern(row as unknown as PatternRow)),
    )
    log.debug(
      `getNewPatterns: windowDays=${windowDays}, threshold=${threshold}, returned=${patterns.length} patterns`,
    )
    return patterns
  }

  /** Return the N most recent runs ordered by `startedAt` DESC. */
  async getRecentRuns(limit: number): Promise<RecentRun[]> {
    const result = await this.wrap('getRecentRuns', () =>
      this.client.execute({
        sql: `SELECT run_id, started_at, ended_at, duration_ms, status,
                     total_tests, passed_tests, failed_tests,
                     errors_between_tests, git_sha, git_dirty
                FROM runs
               ORDER BY started_at DESC
               LIMIT ?`,
        args: [limit] as InArgs,
      }),
    )
    return result.rows.map((row) => {
      const r = row as unknown as Record<string, unknown>
      return {
        runId: String(r.run_id),
        startedAt: String(r.started_at),
        endedAt: r.ended_at == null ? null : String(r.ended_at),
        durationMs: r.duration_ms == null ? null : Number(r.duration_ms),
        status: (r.status as RunStatus | null) ?? null,
        totalTests: r.total_tests == null ? null : Number(r.total_tests),
        passedTests: r.passed_tests == null ? null : Number(r.passed_tests),
        failedTests: r.failed_tests == null ? null : Number(r.failed_tests),
        errorsBetweenTests:
          r.errors_between_tests == null
            ? null
            : Number(r.errors_between_tests),
        gitSha: r.git_sha == null ? null : String(r.git_sha),
        gitDirty: r.git_dirty == null ? null : Number(r.git_dirty) !== 0,
      }
    })
  }

  /** Close the underlying libSQL connection. */
  async close(): Promise<void> {
    await this.wrap('close', async () => {
      this.client.close()
    })
  }
}

/** Lazy plugin descriptor — `create(config)` builds a TursoStore from the resolved config. */
export const tursoStorePlugin = definePlugin({
  name: 'store-turso',
  configSchema: tursoStoreOptionsSchema,
  create(config: Config): TursoStore {
    if (config.store.type !== 'turso') {
      throw new Error(
        `store-turso plugin invoked with config.store.type="${config.store.type}"`,
      )
    }
    return new TursoStore({
      url: config.store.url,
      ...(config.store.authToken !== undefined && {
        authToken: config.store.authToken,
      }),
    })
  },
})
