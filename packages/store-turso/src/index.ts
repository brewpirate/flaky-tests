import {
  type Config,
  CREATE_SCHEMA_VERSION_TABLE,
  createLogger,
  DEFAULT_THRESHOLD,
  DEFAULT_WINDOW_DAYS,
  definePlugin,
  detectBaselineVersion,
  extractMessage,
  type FlakyPattern,
  flakyPatternSchema,
  type GetNewPatternsOptions,
  type GetRecentRunsOptions,
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
  pendingMigrations,
  type RecentRun,
  type RetryOptions,
  type RunStatus,
  raceAbort,
  SCHEMA_VERSION_TABLE,
  type SchemaInspector,
  SQLITE_MIGRATIONS,
  type SqliteMigration,
  StoreError,
  type UpdateRunInput,
  updateRunInputSchema,
  withRetry,
} from '@flaky-tests/core'
import type { Client, InArgs } from '@libsql/client'
import { createClient } from '@libsql/client'
import { type } from 'arktype'

const log = createLogger('store-turso')
const PACKAGE = '@flaky-tests/store-turso'

/**
 * Retry tuning for read methods. Defaults — 3 attempts, 100ms base — come
 * from {@link withRetry}; override per-store to disable (attempts=1) or
 * extend the backoff window. Applies only to read methods; writes are not
 * retried because {@link IStore.insertFailure} lacks an idempotency key.
 */
export const retryOptionsSchema = type({
  'attempts?': 'number > 0',
  'baseMs?': 'number > 0',
})

/** Configuration for the Turso (libSQL) store. */
export const tursoStoreOptionsSchema = type({
  url: type.string.atLeastLength(1),
  'authToken?': 'string',
  'retry?': retryOptionsSchema,
})

/** Inferred options type for {@link TursoStore}: libSQL URL plus optional HTTP auth token. */
export type TursoStoreOptions = typeof tursoStoreOptionsSchema.infer

/** Shape of a row in the bookkeeping `schema_version` table. */
interface SchemaVersionRow {
  version: number
  applied_at: string
}

/**
 * `IStore` implementation targeting libSQL/Turso over HTTP with bearer-token auth.
 * Mirrors the store-sqlite schema and queries verbatim so local and hosted
 * backends stay interchangeable — only the connection URL differs.
 */
export class TursoStore implements IStore {
  private client: Client
  private retryOptions: RetryOptions

  /** Builds the libSQL client from a validated URL and optional auth token. */
  constructor(options: TursoStoreOptions) {
    const validated = parse(tursoStoreOptionsSchema, options)
    this.client = createClient({
      url: validated.url,
      ...(validated.authToken !== undefined && {
        authToken: validated.authToken,
      }),
    })
    this.retryOptions = validated.retry ?? {}
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

  /**
   * Bring the remote libSQL database to the current schema version by
   * applying pending migrations from {@link SQLITE_MIGRATIONS}. Tracks
   * applied versions in a `schema_version` table and seeds a baseline for
   * databases created before versioning landed by probing the live schema.
   */
  async migrate(): Promise<void> {
    await this.wrap('migrate', async () => {
      await this.client.execute(CREATE_SCHEMA_VERSION_TABLE)
      const current = await this.getCurrentVersion()
      const inspector = await this.buildSchemaInspector()
      const baseline =
        current > 0
          ? current
          : detectBaselineVersion(SQLITE_MIGRATIONS, inspector)
      if (baseline > current) {
        const now = new Date().toISOString()
        const seedStatements = []
        for (let version = current + 1; version <= baseline; version++) {
          seedStatements.push({
            sql: `INSERT INTO ${SCHEMA_VERSION_TABLE} (version, applied_at) VALUES (?, ?)`,
            args: [version, now] as InArgs,
          })
        }
        if (seedStatements.length > 0) {
          await this.client.batch(seedStatements, 'write')
        }
      }
      for (const migration of pendingMigrations(SQLITE_MIGRATIONS, baseline)) {
        await this.applyMigration(migration)
      }
    })
  }

  private async getCurrentVersion(): Promise<number> {
    const result = await this.client.execute(
      `SELECT MAX(version) AS version FROM ${SCHEMA_VERSION_TABLE}`,
    )
    const row = result.rows[0] as unknown as
      | { version: number | bigint | null }
      | undefined
    const raw = row?.version
    if (raw == null) return 0
    return typeof raw === 'bigint' ? Number(raw) : raw
  }

  /**
   * Introspect the live schema via SQLite PRAGMAs so migration probes can
   * detect which versions are already materialized on a pre-versioning DB.
   */
  private async buildSchemaInspector(): Promise<SchemaInspector> {
    const tableNames = new Set<string>()
    const columnsByTable = new Map<string, Set<string>>()
    const tables = await this.client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    )
    for (const row of tables.rows) {
      const { name } = row as unknown as { name: string }
      if (typeof name === 'string' && name.length > 0) tableNames.add(name)
    }
    for (const tableName of tableNames) {
      // PRAGMA doesn't accept bind parameters; table names come from our
      // own migration list probes (constants), not user input.
      const info = await this.client.execute(`PRAGMA table_info(${tableName})`)
      const columns = new Set<string>()
      for (const row of info.rows) {
        const { name } = row as unknown as { name: string }
        if (typeof name === 'string') columns.add(name)
      }
      columnsByTable.set(tableName, columns)
    }
    return {
      tableExists: (name) => tableNames.has(name),
      columnExists: (table, column) =>
        columnsByTable.get(table)?.has(column) === true,
    }
  }

  /** Apply one migration's `up` statements + schema_version row atomically. */
  private async applyMigration(migration: SqliteMigration): Promise<void> {
    const now = new Date().toISOString()
    const statements = [
      ...migration.up.map((sql) => ({ sql, args: [] as InArgs })),
      {
        sql: `INSERT INTO ${SCHEMA_VERSION_TABLE} (version, applied_at) VALUES (?, ?)`,
        args: [migration.version, now] as InArgs,
      },
    ]
    await this.client.batch(statements, 'write')
    log.debug(
      `applied migration v${migration.version}: ${migration.description}`,
    )
  }

  /** Expose the applied-migration ledger for tooling/tests. */
  async getAppliedMigrations(): Promise<SchemaVersionRow[]> {
    const result = await this.client.execute(
      `SELECT version, applied_at FROM ${SCHEMA_VERSION_TABLE} ORDER BY version ASC`,
    )
    return result.rows.map((row) => {
      const r = row as unknown as {
        version: number | bigint
        applied_at: string
      }
      return {
        version: typeof r.version === 'bigint' ? Number(r.version) : r.version,
        applied_at: r.applied_at,
      }
    })
  }

  /** Persist a new test-run row. Call before any failures are recorded. */
  async insertRun(input: InsertRunInput): Promise<void> {
    parse(insertRunInputSchema, input)
    await this.wrap('insertRun', () =>
      this.client.execute({
        sql: `INSERT INTO runs (run_id, project, started_at, git_sha, git_dirty, runtime_version, test_args)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          input.runId,
          input.project ?? null,
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
    options.signal?.throwIfAborted()
    const validated = parse(getNewPatternsOptionsSchema, options)
    const windowDays = validated.windowDays ?? DEFAULT_WINDOW_DAYS
    const threshold = validated.threshold ?? DEFAULT_THRESHOLD
    const project = validated.project ?? null
    const now = Date.now()
    const windowStart = new Date(now - windowDays * MS_PER_DAY).toISOString()
    const priorStart = new Date(now - windowDays * 2 * MS_PER_DAY).toISOString()
    const projectClause =
      project === null ? 'r.project IS NULL' : 'r.project = ?'
    const preFilterArgs = [
      windowStart,
      windowStart,
      priorStart,
      windowStart,
      windowStart,
      priorStart,
    ]
    const args =
      project === null
        ? [...preFilterArgs, threshold]
        : [...preFilterArgs, project, threshold]

    // Identical query to store-sqlite — Turso speaks SQLite.
    // libsql has no native AbortSignal support; raceAbort lets the caller
    // observe an AbortError immediately while the request completes in the
    // background and is discarded.
    const result = await this.wrap('getNewPatterns', () =>
      withRetry(
        () =>
          raceAbort(
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
                AND ${projectClause}
              GROUP BY f.test_file, f.test_name
              HAVING recent_fails >= ? AND prior_fails = 0
              ORDER BY recent_fails DESC`,
              args: args as InArgs,
            }),
            options.signal,
          ),
        { ...this.retryOptions, signal: options.signal },
      ),
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

  /** Return the N most recent runs ordered by `startedAt` DESC, filtered by project. */
  async getRecentRuns(options: GetRecentRunsOptions): Promise<RecentRun[]> {
    options.signal?.throwIfAborted()
    const { limit, project = null, signal } = options
    const projectClause = project === null ? 'project IS NULL' : 'project = ?'
    const args = project === null ? [limit] : [project, limit]
    const result = await this.wrap('getRecentRuns', () =>
      withRetry(
        () =>
          raceAbort(
            this.client.execute({
              sql: `SELECT run_id, project, started_at, ended_at, duration_ms, status,
                       total_tests, passed_tests, failed_tests,
                       errors_between_tests, git_sha, git_dirty
                  FROM runs
                 WHERE ${projectClause}
                 ORDER BY started_at DESC
                 LIMIT ?`,
              args: args as InArgs,
            }),
            signal,
          ),
        { ...this.retryOptions, signal },
      ),
    )
    return result.rows.map((row) => {
      const r = row as unknown as Record<string, unknown>
      return {
        runId: String(r.run_id),
        project: r.project == null ? null : String(r.project),
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
      ...(config.store.retry !== undefined && { retry: config.store.retry }),
    })
  },
})
