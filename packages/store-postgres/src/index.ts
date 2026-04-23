import {
  type Config,
  createLogger,
  DEFAULT_THRESHOLD,
  DEFAULT_WINDOW_DAYS,
  definePlugin,
  extractMessage,
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
  type RecentRun,
  type RetryOptions,
  type RunStatus,
  retryOptionsSchema,
  StoreError,
  type UpdateRunInput,
  updateRunInputSchema,
  validateTablePrefix,
  withRetry,
} from '@flaky-tests/core'
import { type } from 'arktype'
import postgres from 'postgres'

const log = createLogger('store-postgres')
const PACKAGE = '@flaky-tests/store-postgres'

/** Configuration for the PostgreSQL store. */
export const postgresStoreOptionsSchema = type({
  'connectionString?': 'string',
  'host?': 'string',
  'port?': 'number.integer > 0',
  'database?': 'string',
  'username?': 'string',
  'password?': 'string',
  'ssl?': "boolean | 'require' | 'prefer' | 'allow'",
  'tablePrefix?': 'string',
  'retry?': retryOptionsSchema,
})

/** Inferred options type for constructing a {@link PostgresStore}. */
export type PostgresStoreOptions = typeof postgresStoreOptionsSchema.infer

/** Standard Postgres listening port; used when the caller omits `port`. */
const DEFAULT_POSTGRES_PORT = 5432

/**
 * postgres-js exposes `.cancel()` on pending queries for server-side cancel.
 * On abort we fire the cancel, then the pending query rejects with postgres-js's
 * cancellation error, which we rethrow as the signal's `reason` (an AbortError)
 * so callers see a uniform abort shape across adapters.
 */
function cancelOnAbort<T>(
  query: PromiseLike<T> & { cancel?: () => void },
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) {
    return Promise.resolve(query)
  }
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      query.cancel?.()
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    Promise.resolve(query).then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/**
 * `IStore` implementation targeting Postgres (including Neon serverless) via the
 * pg-compatible `postgres` driver. Persists runs and failures into two prefix-configurable
 * tables and queries for newly-emerging flaky patterns.
 */
export class PostgresStore implements IStore {
  private sql: ReturnType<typeof postgres>
  private runsTable: string
  private failuresTable: string
  private retryOptions: RetryOptions

  /**
   * Accepts either a full `connectionString` or individual host/port/credentials fields.
   *
   * @throws {@link ValidationError} when `options` fails schema validation.
   * @throws `Error` when `tablePrefix` contains characters outside
   *   `[a-z0-9_]` (via `validateTablePrefix`).
   */
  constructor(options: PostgresStoreOptions = {}) {
    const validated = parse(postgresStoreOptionsSchema, options)
    const prefix = validated.tablePrefix ?? 'flaky_test'
    validateTablePrefix(prefix)
    this.runsTable = `${prefix}_runs`
    this.failuresTable = `${prefix}_failures`
    this.retryOptions = validated.retry ?? {}

    if (validated.connectionString) {
      this.sql = postgres(validated.connectionString)
    } else {
      this.sql = postgres({
        host: validated.host ?? 'localhost',
        port: validated.port ?? DEFAULT_POSTGRES_PORT,
        ...(validated.database !== undefined && {
          database: validated.database,
        }),
        ...(validated.username !== undefined && {
          username: validated.username,
        }),
        ...(validated.password !== undefined && {
          password: validated.password,
        }),
        ...(validated.ssl !== undefined && { ssl: validated.ssl }),
      })
    }
  }

  /** Wraps a driver call so any thrown postgres.js error becomes a {@link StoreError} with `cause` preserved for stack inspection. */
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
   * Create tables and run idempotent schema migrations. Safe to call on every startup.
   *
   * @throws {@link StoreError} when a DDL statement fails at the postgres
   *   driver level (connection refused, insufficient privileges, etc.).
   */
  async migrate(): Promise<void> {
    const runs = this.runsTable
    const failures = this.failuresTable
    await this.wrap('migrate', async () => {
      await this.sql`
        CREATE TABLE IF NOT EXISTS ${this.sql(runs)} (
          run_id                TEXT PRIMARY KEY,
          project               TEXT,
          started_at            TIMESTAMPTZ NOT NULL,
          ended_at              TIMESTAMPTZ,
          duration_ms           INTEGER,
          status                TEXT,
          total_tests           INTEGER,
          passed_tests          INTEGER,
          failed_tests          INTEGER,
          errors_between_tests  INTEGER,
          git_sha               TEXT,
          git_dirty             BOOLEAN,
          runtime_version       TEXT,
          test_args             TEXT
        )
      `
      await this.sql`
        CREATE TABLE IF NOT EXISTS ${this.sql(failures)} (
          id             SERIAL PRIMARY KEY,
          run_id         TEXT NOT NULL REFERENCES ${this.sql(runs)}(run_id),
          test_file      TEXT NOT NULL,
          test_name      TEXT NOT NULL,
          failure_kind   TEXT NOT NULL,
          error_message  TEXT,
          error_stack    TEXT,
          duration_ms    INTEGER,
          failed_at      TIMESTAMPTZ NOT NULL
        )
      `
      await this.sql`
        CREATE INDEX IF NOT EXISTS ${this.sql(`idx_${failures}_test`)}
          ON ${this.sql(failures)}(test_file, test_name)
      `
      await this.sql`
        CREATE INDEX IF NOT EXISTS ${this.sql(`idx_${failures}_run`)}
          ON ${this.sql(failures)}(run_id)
      `
      await this.sql`
        CREATE INDEX IF NOT EXISTS ${this.sql(`idx_${failures}_failed_at`)}
          ON ${this.sql(failures)}(failed_at)
      `
      await this.sql`
        CREATE INDEX IF NOT EXISTS ${this.sql(`idx_${runs}_status`)}
          ON ${this.sql(runs)}(ended_at, failed_tests)
      `
      // Idempotent column add for DBs created before `project` existed.
      await this.sql`
        ALTER TABLE ${this.sql(runs)}
          ADD COLUMN IF NOT EXISTS project TEXT
      `
    })
  }

  /**
   * Insert a new test run record. Must be called before any failures reference this run.
   *
   * @throws {@link ValidationError} when `input` fails schema validation.
   * @throws {@link StoreError} when the postgres driver rejects the insert
   *   (network, auth, duplicate `run_id`, etc.).
   */
  async insertRun(input: InsertRunInput): Promise<void> {
    parse(insertRunInputSchema, input)
    const runs = this.runsTable
    await this.wrap('insertRun', async () => {
      await this.sql`
        INSERT INTO ${this.sql(runs)}
          (run_id, project, started_at, git_sha, git_dirty, runtime_version, test_args)
        VALUES
          (${input.runId}, ${input.project ?? null}, ${input.startedAt},
           ${input.gitSha ?? null}, ${input.gitDirty ?? null},
           ${input.runtimeVersion ?? null}, ${input.testArgs ?? null})
      `
    })
  }

  /**
   * Update a run with final results (duration, status, test counts) after it completes.
   *
   * @throws {@link ValidationError} when `input` fails schema validation.
   * @throws {@link StoreError} when the postgres driver rejects the update.
   */
  async updateRun(runId: string, input: UpdateRunInput): Promise<void> {
    parse(updateRunInputSchema, input)
    const runs = this.runsTable
    await this.wrap('updateRun', async () => {
      await this.sql`
        UPDATE ${this.sql(runs)} SET
          ended_at             = ${input.endedAt ?? null},
          duration_ms          = ${input.durationMs ?? null},
          status               = ${input.status ?? null},
          total_tests          = ${input.totalTests ?? null},
          passed_tests         = ${input.passedTests ?? null},
          failed_tests         = ${input.failedTests ?? null},
          errors_between_tests = ${input.errorsBetweenTests ?? null}
        WHERE run_id = ${runId}
      `
    })
  }

  /**
   * Record a single test failure associated with an existing run.
   *
   * @throws {@link ValidationError} when `input` fails schema validation.
   * @throws {@link StoreError} when the postgres driver rejects the insert.
   */
  async insertFailure(input: InsertFailureInput): Promise<void> {
    parse(insertFailureInputSchema, input)
    const failures = this.failuresTable
    await this.wrap('insertFailure', async () => {
      await this.sql`
        INSERT INTO ${this.sql(failures)}
          (run_id, test_file, test_name, failure_kind,
           error_message, error_stack, duration_ms, failed_at)
        VALUES
          (${input.runId}, ${input.testFile}, ${input.testName},
           ${input.failureKind}, ${input.errorMessage ?? null},
           ${input.errorStack ?? null},
           ${input.durationMs != null ? Math.round(input.durationMs) : null},
           ${input.failedAt})
      `
    })
  }

  /**
   * Insert multiple failures in a single Postgres transaction.
   *
   * @throws {@link ValidationError} when any entry in `inputs` fails schema
   *   validation — the transaction rolls back and nothing is written.
   * @throws {@link StoreError} when the postgres driver rejects the
   *   transaction.
   */
  async insertFailures(inputs: readonly InsertFailureInput[]): Promise<void> {
    if (inputs.length === 0) {
      return
    }
    const failures = this.failuresTable
    await this.wrap('insertFailures', async () => {
      await this.sql.begin(async (transaction) => {
        for (const input of inputs) {
          parse(insertFailureInputSchema, input)
          await transaction`
            INSERT INTO ${transaction(failures)}
              (run_id, test_file, test_name, failure_kind,
               error_message, error_stack, duration_ms, failed_at)
            VALUES
              (${input.runId}, ${input.testFile}, ${input.testName},
               ${input.failureKind}, ${input.errorMessage ?? null},
               ${input.errorStack ?? null},
               ${input.durationMs != null ? Math.round(input.durationMs) : null},
               ${input.failedAt})
          `
        }
      })
    })
  }

  /**
   * Detect newly-flaky tests by comparing a recent window to a prior window of equal length.
   * Returns tests that failed >= `threshold` times in the recent window but zero times
   * in the prior window, filtering out runs with 10+ failures (likely infrastructure issues).
   *
   * @throws {@link ValidationError} when `options` fails schema validation.
   * @throws `DOMException` with `name === 'AbortError'` when
   *   `options.signal` aborts — via `throwIfAborted()` at entry or the
   *   `cancelOnAbort` wrapper, which also fires the pending query's
   *   server-side `cancel()` so the DB releases the connection.
   * @throws {@link StoreError} when the postgres driver rejects the query.
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
    const windowStart = new Date(now - windowDays * MS_PER_DAY)
    const priorStart = new Date(now - windowDays * 2 * MS_PER_DAY)
    const runs = this.runsTable
    const failures = this.failuresTable
    const projectFilter =
      project === null
        ? this.sql`r.project IS NULL`
        : this.sql`r.project = ${project}`

    const rows = await this.wrap('getNewPatterns', () =>
      withRetry(
        () => {
          const query = this.sql<
            Array<{
              test_file: string
              test_name: string
              recent_fails: string
              prior_fails: string
              failure_kinds: string[]
              last_error_message_raw: string | null
              last_error_stack_raw: string | null
              last_failed: Date
            }>
          >`
            SELECT
              f.test_file,
              f.test_name,
              COUNT(*) FILTER (WHERE f.failed_at > ${windowStart})                                    AS recent_fails,
              COUNT(*) FILTER (WHERE f.failed_at <= ${windowStart} AND f.failed_at > ${priorStart})   AS prior_fails,
              ARRAY_AGG(DISTINCT f.failure_kind)                                                       AS failure_kinds,
              MAX(f.failed_at::text || chr(1) || f.error_message) FILTER (WHERE f.failed_at > ${windowStart} AND f.error_message IS NOT NULL) AS last_error_message_raw,
              MAX(f.failed_at::text || chr(1) || f.error_stack)  FILTER (WHERE f.failed_at > ${windowStart} AND f.error_stack IS NOT NULL)  AS last_error_stack_raw,
              MAX(f.failed_at)                                                                         AS last_failed
            FROM ${this.sql(failures)} f
            JOIN ${this.sql(runs)} r ON r.run_id = f.run_id
            WHERE r.failed_tests < ${MAX_FAILED_TESTS_PER_RUN}
              AND r.ended_at IS NOT NULL
              AND f.failed_at > ${priorStart}
              AND ${projectFilter}
            GROUP BY f.test_file, f.test_name
            HAVING COUNT(*) FILTER (WHERE f.failed_at > ${windowStart}) >= ${threshold}
               AND COUNT(*) FILTER (WHERE f.failed_at <= ${windowStart} AND f.failed_at > ${priorStart}) = 0
            ORDER BY recent_fails DESC
          `
          return cancelOnAbort(query, options.signal)
        },
        { ...this.retryOptions, signal: options.signal },
      ),
    )

    const patterns = parseArray(flakyPatternSchema, rows.map(mapRowToPattern))
    log.debug(
      `getNewPatterns: windowDays=${windowDays}, threshold=${threshold}, returned=${patterns.length} patterns`,
    )
    return patterns
  }

  /**
   * Return the N most recent runs ordered by `startedAt` DESC, filtered by project.
   *
   * @throws `DOMException` with `name === 'AbortError'` when
   *   `options.signal` aborts — server-side cancel is fired via
   *   `cancelOnAbort`.
   * @throws {@link StoreError} when the postgres driver rejects the query.
   */
  async getRecentRuns(options: GetRecentRunsOptions): Promise<RecentRun[]> {
    options.signal?.throwIfAborted()
    const { limit, project = null, signal } = options
    const runs = this.runsTable
    const projectFilter =
      project === null
        ? this.sql`project IS NULL`
        : this.sql`project = ${project}`
    const rows = await this.wrap('getRecentRuns', () =>
      withRetry(
        () => {
          const query = this.sql<
            Array<{
              run_id: string
              project: string | null
              started_at: Date
              ended_at: Date | null
              duration_ms: number | null
              status: string | null
              total_tests: number | null
              passed_tests: number | null
              failed_tests: number | null
              errors_between_tests: number | null
              git_sha: string | null
              git_dirty: boolean | null
            }>
          >`
            SELECT run_id, project, started_at, ended_at, duration_ms, status,
                   total_tests, passed_tests, failed_tests,
                   errors_between_tests, git_sha, git_dirty
              FROM ${this.sql(runs)}
             WHERE ${projectFilter}
             ORDER BY started_at DESC
             LIMIT ${limit}
          `
          return cancelOnAbort(query, signal)
        },
        { ...this.retryOptions, signal },
      ),
    )
    const toIso = (value: Date | string | null): string | null => {
      if (value === null) {
        return null
      }
      if (value instanceof Date) {
        return value.toISOString()
      }
      return String(value)
    }
    return rows.map((row) => ({
      runId: row.run_id,
      project: row.project,
      startedAt: toIso(row.started_at) ?? '',
      endedAt: toIso(row.ended_at),
      durationMs: row.duration_ms,
      status: (row.status as RunStatus | null) ?? null,
      totalTests: row.total_tests,
      passedTests: row.passed_tests,
      failedTests: row.failed_tests,
      errorsBetweenTests: row.errors_between_tests,
      gitSha: row.git_sha,
      gitDirty: row.git_dirty,
    }))
  }

  /**
   * Raw failure rows — primitive used by the HTML report to bucket
   * failures by kind, file, or run. See {@link IStore.listFailures}.
   *
   * @throws `DOMException` with `name === 'AbortError'` when `options.signal`
   *   aborts — server-side cancel is fired via `cancelOnAbort`.
   * @throws {@link StoreError} when the postgres driver rejects the query.
   */
  async listFailures(options: ListFailuresOptions): Promise<FailureRow[]> {
    options.signal?.throwIfAborted()
    const {
      since,
      runIds,
      project = null,
      excludeInfraBlowups = true,
      signal,
    } = options
    if (runIds !== undefined && runIds.length === 0) {
      return []
    }
    const runs = this.runsTable
    const failures = this.failuresTable

    const filters: ReturnType<typeof this.sql>[] = []
    if (since !== undefined) {
      filters.push(this.sql`f.failed_at > ${new Date(since)}`)
    }
    if (runIds !== undefined) {
      filters.push(
        this.sql`f.run_id IN ${this.sql(runIds as readonly string[])}`,
      )
    }
    filters.push(
      project === null
        ? this.sql`r.project IS NULL`
        : this.sql`r.project = ${project}`,
    )
    if (excludeInfraBlowups) {
      filters.push(this.sql`r.failed_tests < ${MAX_FAILED_TESTS_PER_RUN}`)
      filters.push(this.sql`r.ended_at IS NOT NULL`)
    }
    // Build `A AND B AND C …` by reducing the filter fragments.
    const whereClause = filters.reduce((accumulator, filter, index) =>
      index === 0 ? filter : this.sql`${accumulator} AND ${filter}`,
    )

    const rows = await this.wrap('listFailures', () =>
      withRetry(
        () => {
          const query = this.sql<
            Array<{
              run_id: string
              test_file: string
              test_name: string
              failure_kind: string
              error_message: string | null
              failed_at: Date | string
            }>
          >`
            SELECT f.run_id, f.test_file, f.test_name, f.failure_kind,
                   f.error_message, f.failed_at
              FROM ${this.sql(failures)} f
              JOIN ${this.sql(runs)} r ON r.run_id = f.run_id
             WHERE ${whereClause}
             ORDER BY f.failed_at ASC
          `
          return cancelOnAbort(query, signal)
        },
        { ...this.retryOptions, signal },
      ),
    )

    return rows.map((row) => ({
      runId: row.run_id,
      testFile: row.test_file,
      testName: row.test_name,
      failureKind: row.failure_kind,
      errorMessage: row.error_message,
      failedAt:
        row.failed_at instanceof Date
          ? row.failed_at.toISOString()
          : String(row.failed_at),
    }))
  }

  /**
   * Gracefully close the underlying PostgreSQL connection pool.
   *
   * @throws {@link StoreError} when `sql.end()` errors draining pending
   *   queries or releasing the connection.
   */
  async close(): Promise<void> {
    await this.wrap('close', () => this.sql.end())
  }
}

/**
 * Lazy plugin descriptor — `create(config)` builds a PostgresStore from the
 * resolved config.
 *
 * @throws `Error` from `create()` when `config.store.type !== 'postgres'`.
 */
export const postgresStorePlugin = definePlugin({
  name: 'store-postgres',
  configSchema: postgresStoreOptionsSchema,
  create(config: Config): PostgresStore {
    if (config.store.type !== 'postgres') {
      throw new Error(
        `store-postgres plugin invoked with config.store.type="${config.store.type}"`,
      )
    }
    const { type: _type, ...storeOptions } = config.store
    return new PostgresStore(storeOptions)
  },
})
