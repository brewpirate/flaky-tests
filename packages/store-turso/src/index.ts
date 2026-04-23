import {
  buildListFailuresQuery,
  buildNewPatternsQuery,
  buildRecentRunsQuery,
  type Config,
  CREATE_SCHEMA_VERSION_TABLE,
  createLogger,
  DEFAULT_THRESHOLD,
  DEFAULT_WINDOW_DAYS,
  definePlugin,
  detectBaselineVersion,
  type FailureRow,
  type FlakyPattern,
  flakyPatternSchema,
  type GetNewPatternsOptions,
  type GetRecentRunsOptions,
  getNewPatternsOptionsSchema,
  INSERT_FAILURE_SQL,
  INSERT_RUN_SQL,
  INSERT_SCHEMA_VERSION_SQL,
  type InsertFailureInput,
  type InsertRunInput,
  type IStore,
  insertFailureInputSchema,
  insertRunInputSchema,
  type ListFailuresOptions,
  makeStoreWrapper,
  mapRowToPattern,
  type PatternRow,
  parse,
  parseArray,
  pendingMigrations,
  pragmaTableInfoSql,
  type RecentRun,
  type RetryOptions,
  type RunStatus,
  raceAbort,
  retryOptionsSchema,
  type SchemaInspector,
  SELECT_APPLIED_MIGRATIONS_SQL,
  SELECT_CURRENT_VERSION_SQL,
  SELECT_USER_TABLES_SQL,
  SQLITE_MIGRATIONS,
  type SqliteMigration,
  UPDATE_RUN_SQL,
  type UpdateRunInput,
  updateRunInputSchema,
  withRetry,
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
  /** Wraps driver calls in {@link StoreError}; see {@link makeStoreWrapper}. */
  private wrap = makeStoreWrapper(PACKAGE)

  /**
   * Builds the libSQL client from a validated URL and optional auth token.
   *
   * @throws {@link ValidationError} when `options` fails schema validation.
   */
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

  /**
   * Bring the remote libSQL database to the current schema version by
   * applying pending migrations from {@link SQLITE_MIGRATIONS}. Tracks
   * applied versions in a `schema_version` table and seeds a baseline for
   * databases created before versioning landed by probing the live schema.
   *
   * @throws {@link StoreError} when a migration statement fails at the
   *   libSQL driver level (network, credentials, incompatible server).
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
        const seedStatements: { sql: string; args: InArgs }[] = []
        for (let version = current + 1; version <= baseline; version++) {
          seedStatements.push({
            sql: INSERT_SCHEMA_VERSION_SQL,
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
    const result = await this.client.execute(SELECT_CURRENT_VERSION_SQL)
    const row = result.rows[0] as unknown as
      | { version: number | bigint | null }
      | undefined
    const raw = row?.version
    if (raw == null) {
      return 0
    }
    return typeof raw === 'bigint' ? Number(raw) : raw
  }

  /**
   * Introspect the live schema via SQLite PRAGMAs so migration probes can
   * detect which versions are already materialized on a pre-versioning DB.
   */
  private async buildSchemaInspector(): Promise<SchemaInspector> {
    const tableNames = new Set<string>()
    const columnsByTable = new Map<string, Set<string>>()
    const tables = await this.client.execute(SELECT_USER_TABLES_SQL)
    for (const row of tables.rows) {
      const { name } = row as unknown as { name: string }
      if (typeof name === 'string' && name.length > 0) {
        tableNames.add(name)
      }
    }
    for (const tableName of tableNames) {
      // PRAGMA doesn't accept bind parameters; table names come from our
      // own migration list probes (constants), not user input.
      const info = await this.client.execute(pragmaTableInfoSql(tableName))
      const columns = new Set<string>()
      for (const row of info.rows) {
        const { name } = row as unknown as { name: string }
        if (typeof name === 'string') {
          columns.add(name)
        }
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
        sql: INSERT_SCHEMA_VERSION_SQL,
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
    const result = await this.client.execute(SELECT_APPLIED_MIGRATIONS_SQL)
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

  /**
   * Persist a new test-run row. Call before any failures are recorded.
   *
   * @throws {@link ValidationError} when `input` fails schema validation.
   * @throws {@link StoreError} when the libSQL driver rejects the insert
   *   (network, auth, duplicate `run_id`, etc.).
   */
  async insertRun(input: InsertRunInput): Promise<void> {
    parse(insertRunInputSchema, input)
    await this.wrap('insertRun', () =>
      this.client.execute({
        sql: INSERT_RUN_SQL,
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

  /**
   * Update a run with its final summary (status, counts, duration).
   *
   * @throws {@link ValidationError} when `input` fails schema validation.
   * @throws {@link StoreError} when the libSQL driver rejects the update.
   */
  async updateRun(runId: string, input: UpdateRunInput): Promise<void> {
    parse(updateRunInputSchema, input)
    await this.wrap('updateRun', () =>
      this.client.execute({
        sql: UPDATE_RUN_SQL,
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

  /**
   * Record a single test failure linked to an existing run.
   *
   * @throws {@link ValidationError} when `input` fails schema validation.
   * @throws {@link StoreError} when the libSQL driver rejects the insert.
   */
  async insertFailure(input: InsertFailureInput): Promise<void> {
    parse(insertFailureInputSchema, input)
    await this.wrap('insertFailure', () =>
      this.client.execute({
        sql: INSERT_FAILURE_SQL,
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

  /**
   * Insert multiple failures in a single batch transaction.
   *
   * @throws {@link ValidationError} when any entry in `inputs` fails schema
   *   validation — the batch is not sent.
   * @throws {@link StoreError} when the libSQL driver rejects the batch.
   */
  async insertFailures(inputs: readonly InsertFailureInput[]): Promise<void> {
    if (inputs.length === 0) {
      return
    }
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
   * @throws {@link ValidationError} when `options` fails schema validation.
   * @throws `DOMException` with `name === 'AbortError'` when
   *   `options.signal` aborts — via `throwIfAborted()` at entry or the
   *   `raceAbort` wrapper that rejects the caller while the underlying
   *   libSQL request continues in the background.
   * @throws {@link StoreError} when the libSQL driver rejects the query.
   */
  async getNewPatterns(
    options: GetNewPatternsOptions = {},
  ): Promise<FlakyPattern[]> {
    options.signal?.throwIfAborted()
    const validated = parse(getNewPatternsOptionsSchema, options)
    const windowDays = validated.windowDays ?? DEFAULT_WINDOW_DAYS
    const threshold = validated.threshold ?? DEFAULT_THRESHOLD
    const project = validated.project ?? null
    const query = buildNewPatternsQuery({ windowDays, threshold, project })

    // libsql has no native AbortSignal support; raceAbort lets the caller
    // observe an AbortError immediately while the request completes in the
    // background and is discarded.
    const result = await this.wrap('getNewPatterns', () =>
      withRetry(
        () =>
          raceAbort(
            this.client.execute({
              sql: query.sql,
              args: query.args as InArgs,
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

  /**
   * Return the N most recent runs ordered by `startedAt` DESC, filtered by project.
   *
   * @throws `DOMException` with `name === 'AbortError'` when
   *   `options.signal` aborts.
   * @throws {@link StoreError} when the libSQL driver rejects the query.
   */
  async getRecentRuns(options: GetRecentRunsOptions): Promise<RecentRun[]> {
    options.signal?.throwIfAborted()
    const { signal } = options
    const query = buildRecentRunsQuery(options)
    const result = await this.wrap('getRecentRuns', () =>
      withRetry(
        () =>
          raceAbort(
            this.client.execute({
              sql: query.sql,
              args: query.args as InArgs,
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

  /**
   * Raw failure rows in the same shape as store-sqlite — Turso speaks SQLite.
   * See {@link IStore.listFailures}.
   *
   * @throws `DOMException` with `name === 'AbortError'` when `options.signal` aborts.
   * @throws {@link StoreError} when the libSQL driver rejects the query.
   */
  async listFailures(options: ListFailuresOptions): Promise<FailureRow[]> {
    options.signal?.throwIfAborted()
    const { signal } = options
    const query = buildListFailuresQuery(options)
    if ('empty' in query) {
      return []
    }

    const result = await this.wrap('listFailures', () =>
      withRetry(
        () =>
          raceAbort(
            this.client.execute({
              sql: query.sql,
              args: query.args as InArgs,
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
        testFile: String(r.test_file),
        testName: String(r.test_name),
        failureKind: String(r.failure_kind),
        errorMessage: r.error_message == null ? null : String(r.error_message),
        failedAt: String(r.failed_at),
      }
    })
  }

  /**
   * Close the underlying libSQL connection.
   *
   * @throws {@link StoreError} when the driver's `close()` throws — rare
   *   in practice, but wrapped for a uniform error surface.
   */
  async close(): Promise<void> {
    await this.wrap('close', () => {
      this.client.close()
      return Promise.resolve()
    })
  }
}

/**
 * Lazy plugin descriptor — `create(config)` builds a TursoStore from the
 * resolved config.
 *
 * @throws `Error` from `create()` when `config.store.type !== 'turso'`.
 */
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
