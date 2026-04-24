import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
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
  SELECT_RUN_STATUS_SQL,
  SELECT_USER_TABLES_SQL,
  SQLITE_MIGRATIONS,
  type SqliteMigration,
  UPDATE_RUN_RECONCILE_SQL,
  UPDATE_RUN_SQL,
  type UpdateRunInput,
  updateRunInputSchema,
  withRetry,
} from '@flaky-tests/core'
import type { Client, InArgs } from '@libsql/client'
import { createClient } from '@libsql/client'
import { type } from 'arktype'

const log = createLogger('store-sqlite')
const PACKAGE = '@flaky-tests/store-sqlite'

/** Configuration for the SQLite-backed flaky-tests store. */
export const sqliteStoreOptionsSchema = type({
  'dbPath?': 'string | undefined',
  'retry?': retryOptionsSchema,
})

/** Inferred options type for {@link SqliteStore}; accepted by its constructor. */
export type SqliteStoreOptions = typeof sqliteStoreOptionsSchema.infer

const DEFAULT_DB_PATH = './failures.db'

/** Shape of a row in the bookkeeping `schema_version` table. */
interface SchemaVersionRow {
  version: number
  applied_at: string
}

/** Ensure the parent directory for `dbPath` exists so libsql can create the file. */
function ensureDirectory(dbPath: string): void {
  if (dbPath === ':memory:' || dbPath.startsWith('file:')) {
    return
  }
  const parent = dirname(dbPath)
  if (parent === '' || parent === '.') {
    return
  }
  try {
    mkdirSync(parent, { recursive: true })
  } catch {
    // Best-effort — libsql will surface a clearer error if open fails.
  }
}

/**
 * Translate a user-facing `dbPath` (`./foo.db`, absolute path, `:memory:`) to
 * the `file:` / `libsql:` URL form libsql expects.
 */
function resolveDbUrl(dbPath: string): string {
  if (dbPath === ':memory:') {
    // Connection-private in-memory DB — no `cache=shared` so each client
    // gets its own, matching bun:sqlite's default behavior. Tests rely on
    // this isolation.
    return ':memory:'
  }
  if (dbPath.startsWith('file:') || dbPath.startsWith('libsql:')) {
    return dbPath
  }
  const absolute = isAbsolute(dbPath) ? dbPath : resolve(dbPath)
  return pathToFileURL(absolute).href
}

/**
 * Local SQLite-backed {@link IStore} implementation.
 *
 * Runs on Node or Bun — uses `@libsql/client` with a `file:` URL so the
 * same adapter works everywhere instead of locking consumers to Bun's
 * built-in `bun:sqlite`. The SQL dialect is identical to
 * {@link TursoStore}; only the URL scheme differs. Call {@link migrate}
 * explicitly after construction.
 */
export class SqliteStore implements IStore {
  private client: Client
  private retryOptions: RetryOptions
  /** Wraps driver calls in {@link StoreError}; see {@link makeStoreWrapper}. */
  private wrap = makeStoreWrapper(PACKAGE)

  /**
   * Open (or create) a local libSQL database at `dbPath`.
   * @param options - Store configuration; uses sensible defaults when omitted.
   * @throws {@link ValidationError} when `options` fails schema validation.
   */
  constructor(options: SqliteStoreOptions = {}) {
    const validated = parse(sqliteStoreOptionsSchema, options)
    const dbPath = validated.dbPath ?? DEFAULT_DB_PATH
    log.debug(
      `SqliteStore: dbPath=${dbPath} (source=${validated.dbPath ? 'options' : 'default'})`,
    )
    ensureDirectory(dbPath)
    this.client = createClient({ url: resolveDbUrl(dbPath) })
    this.retryOptions = validated.retry ?? {}
  }

  /**
   * Bring the database to the current schema version by applying pending
   * migrations from {@link SQLITE_MIGRATIONS}. Safe to call on every startup:
   * tracks applied versions in the `schema_version` table, and for databases
   * created before versioning existed, seeds a baseline by probing which
   * columns already exist — so we never re-run DDL that would fail.
   *
   * @throws {@link StoreError} when a migration statement fails at the
   *   libSQL driver level (corrupt DB, insufficient filesystem perms).
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

  /** Introspect the live schema via SQLite PRAGMAs so migration probes can
   *  detect which versions are already materialized on a pre-versioning DB. */
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
      tableExists: (name: string): boolean => tableNames.has(name),
      columnExists: (table: string, column: string): boolean =>
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
   * Record a new test run. Called at the start of a test session.
   * @throws {@link ValidationError} when `input` fails schema validation.
   * @throws {@link StoreError} when the libSQL driver rejects the insert —
   *   most commonly a duplicate `run_id`.
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
   * Finalize a run with end-of-session stats.
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
   * Record an individual test failure within a run.
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
   * Reconcile a run's status against the real process exit code. Called by
   * `run-tracked` when `bun test` exits non-zero but the preload recorded
   * status='pass' (e.g. module-load errors bypassed the preload).
   *
   * @throws {@link StoreError} when the update fails.
   */
  async reconcileRun(runId: string): Promise<void> {
    await this.wrap('reconcileRun', async () => {
      const existing = await this.client.execute({
        sql: SELECT_RUN_STATUS_SQL,
        args: [runId] as InArgs,
      })
      const row = existing.rows[0] as unknown as
        | { status: string | null }
        | undefined
      if (row == null || row.status !== 'pass') {
        return
      }
      await this.client.execute({
        sql: UPDATE_RUN_RECONCILE_SQL,
        args: [runId] as InArgs,
      })
      log.warn(
        `Run ${runId} exited with failure but preload recorded status=pass. Overriding to fail.`,
      )
    })
  }

  /**
   * Detect newly-flaky tests by comparing recent failures against a prior window.
   *
   * @throws {@link ValidationError} when `options` fails schema validation.
   * @throws `DOMException` with `name === 'AbortError'` when
   *   `options.signal` aborts.
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

    const patterns = parseArray(
      flakyPatternSchema,
      result.rows.map((row) => mapRowToPattern(row as unknown as PatternRow)),
    )
    log.debug(
      `getNewPatterns: windowDays=${windowDays}, threshold=${threshold}, project=${project ?? '<null>'}, returned=${patterns.length} patterns`,
    )
    return patterns
  }

  /**
   * Return the N most recent runs ordered by `startedAt` DESC, filtered by project.
   *
   * @throws `DOMException` with `name === 'AbortError'` when `options.signal` aborts.
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
   * Raw failure rows used by the HTML report and other consumers. See
   * {@link IStore.listFailures}.
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

  /** Close the underlying libSQL connection. */
  async close(): Promise<void> {
    await this.wrap('close', () => {
      this.client.close()
      return Promise.resolve()
    })
  }

  /** Expose the underlying libSQL client for advanced use (e.g. report generation). */
  getClient(): Client {
    return this.client
  }
}

/**
 * Lazy plugin descriptor — `create(config)` builds a SqliteStore from the
 * resolved config.
 *
 * @throws `Error` from `create()` when `config.store.type !== 'sqlite'`.
 */
export const sqliteStorePlugin = definePlugin({
  name: 'store-sqlite',
  configSchema: sqliteStoreOptionsSchema,
  create(config: Config): SqliteStore {
    if (config.store.type !== 'sqlite') {
      throw new Error(
        `store-sqlite plugin invoked with config.store.type="${config.store.type}"`,
      )
    }
    return new SqliteStore({
      ...(config.store.path !== undefined && { dbPath: config.store.path }),
    })
  },
})
