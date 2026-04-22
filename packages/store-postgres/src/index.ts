import {
  type Config,
  createLogger,
  DEFAULT_THRESHOLD,
  DEFAULT_WINDOW_DAYS,
  definePlugin,
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
  parse,
  parseArray,
  type UpdateRunInput,
  updateRunInputSchema,
  validateTablePrefix,
} from '@flaky-tests/core'
import { type } from 'arktype'
import postgres from 'postgres'

const log = createLogger('store-postgres')

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
})

/** Inferred options type for constructing a {@link PostgresStore}. */
export type PostgresStoreOptions = typeof postgresStoreOptionsSchema.infer

/**
 * `IStore` implementation targeting Postgres (including Neon serverless) via the
 * pg-compatible `postgres` driver. Persists runs and failures into two prefix-configurable
 * tables and queries for newly-emerging flaky patterns.
 */
export class PostgresStore implements IStore {
  private sql: ReturnType<typeof postgres>
  private runsTable: string
  private failuresTable: string

  /** Accepts either a full `connectionString` or individual host/port/credentials fields. */
  constructor(options: PostgresStoreOptions = {}) {
    const validated = parse(postgresStoreOptionsSchema, options)
    const prefix = validated.tablePrefix ?? 'flaky_test'
    validateTablePrefix(prefix)
    this.runsTable = `${prefix}_runs`
    this.failuresTable = `${prefix}_failures`

    if (validated.connectionString) {
      this.sql = postgres(validated.connectionString)
    } else {
      this.sql = postgres({
        host: validated.host ?? 'localhost',
        port: validated.port ?? 5432,
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

  /** Create tables and run idempotent schema migrations. Safe to call on every startup. */
  async migrate(): Promise<void> {
    const runs = this.runsTable
    const failures = this.failuresTable
    await this.sql`
      CREATE TABLE IF NOT EXISTS ${this.sql(runs)} (
        run_id                TEXT PRIMARY KEY,
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
  }

  /** Insert a new test run record. Must be called before any failures reference this run. */
  async insertRun(input: InsertRunInput): Promise<void> {
    parse(insertRunInputSchema, input)
    const runs = this.runsTable
    await this.sql`
      INSERT INTO ${this.sql(runs)}
        (run_id, started_at, git_sha, git_dirty, runtime_version, test_args)
      VALUES
        (${input.runId}, ${input.startedAt}, ${input.gitSha ?? null},
         ${input.gitDirty ?? null}, ${input.runtimeVersion ?? null},
         ${input.testArgs ?? null})
    `
  }

  /** Update a run with final results (duration, status, test counts) after it completes. */
  async updateRun(runId: string, input: UpdateRunInput): Promise<void> {
    parse(updateRunInputSchema, input)
    const runs = this.runsTable
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
  }

  /** Record a single test failure associated with an existing run. */
  async insertFailure(input: InsertFailureInput): Promise<void> {
    parse(insertFailureInputSchema, input)
    const failures = this.failuresTable
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
  }

  /** Insert multiple failures in a single Postgres transaction. */
  async insertFailures(inputs: readonly InsertFailureInput[]): Promise<void> {
    if (inputs.length === 0) return
    const failures = this.failuresTable
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
  }

  /**
   * Detect newly-flaky tests by comparing a recent window to a prior window of equal length.
   * Returns tests that failed >= `threshold` times in the recent window but zero times
   * in the prior window, filtering out runs with 10+ failures (likely infrastructure issues).
   */
  async getNewPatterns(
    options: GetNewPatternsOptions = {},
  ): Promise<FlakyPattern[]> {
    const validated = parse(getNewPatternsOptionsSchema, options)
    const windowDays = validated.windowDays ?? DEFAULT_WINDOW_DAYS
    const threshold = validated.threshold ?? DEFAULT_THRESHOLD
    const now = Date.now()
    const windowStart = new Date(now - windowDays * MS_PER_DAY)
    const priorStart = new Date(now - windowDays * 2 * MS_PER_DAY)
    const runs = this.runsTable
    const failures = this.failuresTable

    const rows = await this.sql<
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
      GROUP BY f.test_file, f.test_name
      HAVING COUNT(*) FILTER (WHERE f.failed_at > ${windowStart}) >= ${threshold}
         AND COUNT(*) FILTER (WHERE f.failed_at <= ${windowStart} AND f.failed_at > ${priorStart}) = 0
      ORDER BY recent_fails DESC
    `

    const patterns = parseArray(flakyPatternSchema, rows.map(mapRowToPattern))
    log.debug(
      `getNewPatterns: windowDays=${windowDays}, threshold=${threshold}, returned=${patterns.length} patterns`,
    )
    return patterns
  }

  /** Gracefully close the underlying PostgreSQL connection pool. */
  async close(): Promise<void> {
    await this.sql.end()
  }
}

/** Lazy plugin descriptor — `create(config)` builds a PostgresStore from the resolved config. */
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
