import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import {
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
  type InsertFailureInput,
  type InsertRunInput,
  type IStore,
  insertFailureInputSchema,
  insertRunInputSchema,
  type ListFailuresOptions,
  MAX_FAILED_TESTS_PER_RUN,
  MS_PER_DAY,
  mapRowToPattern,
  parse,
  parseArray,
  pendingMigrations,
  type RecentRun,
  type RunStatus,
  SCHEMA_VERSION_TABLE,
  type SchemaInspector,
  SQLITE_MIGRATIONS,
  type SqliteMigration,
  type UpdateRunInput,
  updateRunInputSchema,
} from '@flaky-tests/core'
import { type } from 'arktype'

const log = createLogger('store-sqlite')

/** Configuration for the SQLite-backed flaky-tests store. */
export const sqliteStoreOptionsSchema = type({
  'dbPath?': 'string | undefined',
})

/** Inferred options type for {@link SqliteStore}; accepted by its constructor. */
export type SqliteStoreOptions = typeof sqliteStoreOptionsSchema.infer

const DEFAULT_DB_PATH = './failures.db'

/** Row shape in the bookkeeping `schema_version` table. */
interface SchemaVersionRow {
  version: number
  applied_at: string
}

/** Row shape returned by SQLite's `PRAGMA table_info(...)`. */
interface PragmaTableInfoRow {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

/** Build a {@link SchemaInspector} backed by SQLite `PRAGMA` introspection. */
function makeSqliteInspector(db: Database): SchemaInspector {
  return {
    tableExists: (name) => {
      const row = db
        .query<{ name: string }, [string]>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ? LIMIT 1",
        )
        .get(name)
      return row !== null
    },
    columnExists: (table, column) => {
      // PRAGMA doesn't accept bind parameters; `table` is a trusted constant
      // from our migration list, not user input, so interpolation is safe.
      const rows = db
        .query<PragmaTableInfoRow, []>(`PRAGMA table_info(${table})`)
        .all()
      return rows.some((row) => row.name === column)
    },
  }
}

/** Create the parent directory for the DB file if missing so SQLite can open it. */
function ensureDirectory(dbPath: string): void {
  const lastSlash = dbPath.lastIndexOf('/')
  if (lastSlash <= 0) {
    return
  }
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
   * @throws {@link ValidationError} when `options` fails schema validation.
   */
  constructor(options: SqliteStoreOptions = {}) {
    const validated = parse(sqliteStoreOptionsSchema, options)
    const dbPath = validated.dbPath ?? DEFAULT_DB_PATH
    log.debug(
      `SqliteStore: dbPath=${dbPath} (source=${validated.dbPath ? 'options' : 'default'})`,
    )
    ensureDirectory(dbPath)
    this.db = new Database(dbPath, { create: true })
    this.db.exec('PRAGMA journal_mode = WAL')
    // `migrate` is sync under bun:sqlite (only exec calls) but declared async
    // by the IStore contract; constructors can't await so we fire-and-forget.
    void this.migrate()
  }

  /**
   * Bring the database to the current schema version by applying pending
   * migrations from {@link SQLITE_MIGRATIONS}. Safe to call on every startup:
   * tracks applied versions in the `schema_version` table, and for databases
   * created before versioning existed, seeds a baseline by probing which
   * columns already exist — so we never re-run DDL that would fail.
   *
   * @throws {@link SQLiteError} (from `bun:sqlite`) when a migration DDL
   *   statement fails — e.g. corrupt DB file, insufficient filesystem
   *   permissions.
   */
  async migrate(): Promise<void> {
    this.db.exec(CREATE_SCHEMA_VERSION_TABLE)
    const current = this.getCurrentVersion()
    const baseline =
      current > 0
        ? current
        : detectBaselineVersion(SQLITE_MIGRATIONS, makeSqliteInspector(this.db))
    if (baseline > current) {
      // Seed rows for migrations whose effects already live in the schema —
      // without running their DDL again.
      const now = new Date().toISOString()
      const seed = this.db.prepare(
        `INSERT INTO ${SCHEMA_VERSION_TABLE} (version, applied_at) VALUES (?, ?)`,
      )
      this.db.transaction(() => {
        for (let version = current + 1; version <= baseline; version++) {
          seed.run(version, now)
        }
      })()
    }
    for (const migration of pendingMigrations(SQLITE_MIGRATIONS, baseline)) {
      this.applyMigration(migration)
    }
  }

  private getCurrentVersion(): number {
    const row = this.db
      .query<{ version: number | null }, []>(
        `SELECT MAX(version) AS version FROM ${SCHEMA_VERSION_TABLE}`,
      )
      .get()
    return row?.version ?? 0
  }

  /** Apply one migration's `up` statements and record the version atomically. */
  private applyMigration(migration: SqliteMigration): void {
    const now = new Date().toISOString()
    this.db.transaction(() => {
      for (const statement of migration.up) {
        this.db.exec(statement)
      }
      this.db.run(
        `INSERT INTO ${SCHEMA_VERSION_TABLE} (version, applied_at) VALUES (?, ?)`,
        [migration.version, now],
      )
    })()
    log.debug(
      `applied migration v${migration.version}: ${migration.description}`,
    )
  }

  /** Expose the applied-migration ledger for tooling/tests. */
  getAppliedMigrations(): SchemaVersionRow[] {
    return this.db
      .query<SchemaVersionRow, []>(
        `SELECT version, applied_at FROM ${SCHEMA_VERSION_TABLE} ORDER BY version ASC`,
      )
      .all()
  }

  /**
   * Record a new test run. Called at the start of a test session.
   * @param input - Run metadata including ID, timestamp, and optional git info.
   * @throws {@link ValidationError} when `input` fails schema validation.
   * @throws {@link SQLiteError} (from `bun:sqlite`) when the insert is
   *   rejected — most commonly a duplicate `run_id`.
   */
  async insertRun(input: InsertRunInput): Promise<void> {
    parse(insertRunInputSchema, input)
    this.db.run(
      `INSERT INTO runs (run_id, project, started_at, git_sha, git_dirty, runtime_version, test_args)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        input.runId,
        input.project ?? null,
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
   * @throws {@link ValidationError} when `input` fails schema validation.
   * @throws {@link SQLiteError} (from `bun:sqlite`) when the update fails.
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
   * @throws {@link ValidationError} when `input` fails schema validation.
   * @throws {@link SQLiteError} (from `bun:sqlite`) when the insert fails —
   *   e.g. foreign-key violation when `input.runId` has no matching row in
   *   `runs`.
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

  /**
   * Insert multiple failures in a single SQLite transaction.
   *
   * @throws {@link ValidationError} when any entry in `inputs` fails schema
   *   validation — the transaction rolls back and nothing is written.
   * @throws {@link SQLiteError} (from `bun:sqlite`) when the transaction
   *   fails at the driver level.
   */
  async insertFailures(inputs: readonly InsertFailureInput[]): Promise<void> {
    if (inputs.length === 0) {
      return
    }
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

    if (row === null || row.status !== 'pass') {
      return
    }

    this.db.run(
      `UPDATE runs
          SET status               = 'fail',
              errors_between_tests = COALESCE(errors_between_tests, 0) + 1
        WHERE run_id = ?`,
      [runId],
    )
    log.warn(
      `Run ${runId} exited with failure but preload recorded status=pass. Overriding to fail.`,
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
   * @throws {@link ValidationError} when `options` fails schema validation.
   * @throws `DOMException` with `name === 'AbortError'` when
   *   `options.signal` aborts before the query starts — `bun:sqlite` is
   *   synchronous so mid-query cancellation is not supported.
   * @throws {@link SQLiteError} (from `bun:sqlite`) when the query fails.
   */
  async getNewPatterns(
    options: GetNewPatternsOptions = {},
  ): Promise<FlakyPattern[]> {
    // bun:sqlite is synchronous — no mid-query cancellation possible.
    options.signal?.throwIfAborted()
    const validated = parse(getNewPatternsOptionsSchema, options)
    const windowDays = validated.windowDays ?? DEFAULT_WINDOW_DAYS
    const threshold = validated.threshold ?? DEFAULT_THRESHOLD
    const now = Date.now()
    const windowStart = new Date(now - windowDays * MS_PER_DAY).toISOString()
    const priorStart = new Date(now - windowDays * 2 * MS_PER_DAY).toISOString()
    const project = validated.project ?? null
    const projectClause =
      project === null ? 'r.project IS NULL' : 'r.project = ?'

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

    // Argument order matches the `?` placeholders in the SQL below:
    // 6x window/prior timestamps, then the project filter (only when
    // `project !== null`; `IS NULL` takes no placeholder), then threshold.
    const preFilterArgs = [
      windowStart,
      windowStart,
      priorStart,
      windowStart,
      windowStart,
      priorStart,
    ] as const
    const queryArgs =
      project === null
        ? ([...preFilterArgs, threshold] as const)
        : ([...preFilterArgs, project, threshold] as const)

    const rows = this.db
      .query<Row, (string | number)[]>(
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
          AND ${projectClause}
        GROUP BY f.test_file, f.test_name
        HAVING recent_fails >= ? AND prior_fails = 0
        ORDER BY recent_fails DESC`,
      )
      .all(...queryArgs)

    const patterns = parseArray(flakyPatternSchema, rows.map(mapRowToPattern))
    log.debug(
      `getNewPatterns: windowDays=${windowDays}, threshold=${threshold}, project=${project ?? '<null>'}, returned=${patterns.length} patterns`,
    )
    return patterns
  }

  /**
   * Return the N most recent runs ordered by `startedAt` DESC, filtered by project.
   *
   * @throws `DOMException` with `name === 'AbortError'` when
   *   `options.signal` aborts before the query starts.
   * @throws {@link SQLiteError} (from `bun:sqlite`) when the query fails.
   */
  async getRecentRuns(options: GetRecentRunsOptions): Promise<RecentRun[]> {
    options.signal?.throwIfAborted()
    const { limit, project = null } = options
    type Row = {
      run_id: string
      project: string | null
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
    const projectClause = project === null ? 'project IS NULL' : 'project = ?'
    const args: (string | number)[] =
      project === null ? [limit] : [project, limit]
    const rows = this.db
      .query<Row, (string | number)[]>(
        `SELECT run_id, project, started_at, ended_at, duration_ms, status,
                total_tests, passed_tests, failed_tests,
                errors_between_tests, git_sha, git_dirty
           FROM runs
          WHERE ${projectClause}
          ORDER BY started_at DESC
          LIMIT ?`,
      )
      .all(...args)
    return rows.map((row) => ({
      runId: row.run_id,
      project: row.project,
      startedAt: row.started_at,
      endedAt: row.ended_at,
      durationMs: row.duration_ms,
      status: (row.status as RunStatus | null) ?? null,
      totalTests: row.total_tests,
      passedTests: row.passed_tests,
      failedTests: row.failed_tests,
      errorsBetweenTests: row.errors_between_tests,
      gitSha: row.git_sha,
      gitDirty: row.git_dirty === null ? null : row.git_dirty !== 0,
    }))
  }

  /**
   * Raw failure rows used by the HTML report and other consumers that need
   * to bucket failures (by kind, by file, by run). `since` filters on
   * `failed_at`; `runIds` narrows to specific runs; both AND-combine when
   * present. `excludeInfraBlowups` defaults to `true`, matching
   * {@link getNewPatterns}.
   *
   * @throws `DOMException` with `name === 'AbortError'` when
   *   `options.signal` aborts before the query starts.
   * @throws {@link SQLiteError} (from `bun:sqlite`) when the query fails.
   */
  async listFailures(options: ListFailuresOptions): Promise<FailureRow[]> {
    options.signal?.throwIfAborted()
    const {
      since,
      runIds,
      project = null,
      excludeInfraBlowups = true,
    } = options

    const conditions: string[] = []
    const args: (string | number)[] = []

    if (since !== undefined) {
      conditions.push('f.failed_at > ?')
      args.push(since)
    }
    if (runIds !== undefined) {
      if (runIds.length === 0) {
        return []
      }
      const placeholders = runIds.map(() => '?').join(', ')
      conditions.push(`f.run_id IN (${placeholders})`)
      args.push(...runIds)
    }
    if (project === null) {
      conditions.push('r.project IS NULL')
    } else {
      conditions.push('r.project = ?')
      args.push(project)
    }
    if (excludeInfraBlowups) {
      conditions.push(`r.failed_tests < ${MAX_FAILED_TESTS_PER_RUN}`)
      conditions.push('r.ended_at IS NOT NULL')
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = this.db
      .query<
        {
          run_id: string
          test_file: string
          test_name: string
          failure_kind: string
          error_message: string | null
          failed_at: string
        },
        (string | number)[]
      >(
        `SELECT f.run_id, f.test_file, f.test_name, f.failure_kind,
                f.error_message, f.failed_at
           FROM failures f
           JOIN runs r ON r.run_id = f.run_id
           ${whereClause}
          ORDER BY f.failed_at ASC`,
      )
      .all(...args)

    return rows.map((row) => ({
      runId: row.run_id,
      testFile: row.test_file,
      testName: row.test_name,
      failureKind: row.failure_kind,
      errorMessage: row.error_message,
      failedAt: row.failed_at,
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
