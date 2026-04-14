import postgres from 'postgres'
import type {
  FlakyPattern,
  GetNewPatternsOptions,
  InsertFailureInput,
  InsertRunInput,
  IStore,
  UpdateRunInput,
} from '@flaky-tests/core'

export interface PostgresStoreOptions {
  /** Full connection string, e.g. postgres://user:pass@host:5432/db */
  connectionString?: string
  host?: string
  port?: number
  database?: string
  username?: string
  password?: string
  ssl?: boolean | 'require' | 'prefer' | 'allow'
  /**
   * Table name prefix. Defaults to `flaky_test`, producing tables
   * `flaky_test_runs` and `flaky_test_failures`.
   */
  tablePrefix?: string
}

export class PostgresStore implements IStore {
  private sql: ReturnType<typeof postgres>
  private runsTable: string
  private failuresTable: string

  constructor(options: PostgresStoreOptions = {}) {
    const prefix = options.tablePrefix ?? 'flaky_test'
    this.runsTable = `${prefix}_runs`
    this.failuresTable = `${prefix}_failures`

    if (options.connectionString) {
      this.sql = postgres(options.connectionString)
    } else {
      this.sql = postgres({
        host: options.host ?? 'localhost',
        port: options.port ?? 5432,
        database: options.database,
        username: options.username,
        password: options.password,
        ssl: options.ssl,
      })
    }
  }

  async insertRun(input: InsertRunInput): Promise<void> {
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

  async updateRun(runId: string, input: UpdateRunInput): Promise<void> {
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

  async insertFailure(input: InsertFailureInput): Promise<void> {
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

  async getNewPatterns(options: GetNewPatternsOptions = {}): Promise<FlakyPattern[]> {
    const windowDays = options.windowDays ?? 7
    const threshold = options.threshold ?? 2
    const now = Date.now()
    const windowStart = new Date(now - windowDays * 86400000)
    const priorStart = new Date(now - windowDays * 2 * 86400000)
    const runs = this.runsTable
    const failures = this.failuresTable

    const rows = await this.sql<Array<{
      test_file: string
      test_name: string
      recent_fails: string
      prior_fails: string
      failure_kinds: string[]
      last_error_message: string | null
      last_error_stack: string | null
      last_failed: Date
    }>>`
      SELECT
        f.test_file,
        f.test_name,
        COUNT(*) FILTER (WHERE f.failed_at > ${windowStart})                                    AS recent_fails,
        COUNT(*) FILTER (WHERE f.failed_at <= ${windowStart} AND f.failed_at > ${priorStart})   AS prior_fails,
        ARRAY_AGG(DISTINCT f.failure_kind)                                                       AS failure_kinds,
        MAX(f.error_message) FILTER (WHERE f.failed_at > ${windowStart})                        AS last_error_message,
        MAX(f.error_stack)   FILTER (WHERE f.failed_at > ${windowStart})                        AS last_error_stack,
        MAX(f.failed_at)                                                                         AS last_failed
      FROM ${this.sql(failures)} f
      JOIN ${this.sql(runs)} r ON r.run_id = f.run_id
      WHERE r.failed_tests < 10
        AND r.ended_at IS NOT NULL
        AND f.failed_at > ${priorStart}
      GROUP BY f.test_file, f.test_name
      HAVING COUNT(*) FILTER (WHERE f.failed_at > ${windowStart}) >= ${threshold}
         AND COUNT(*) FILTER (WHERE f.failed_at <= ${windowStart} AND f.failed_at > ${priorStart}) = 0
      ORDER BY recent_fails DESC
    `

    return rows.map((r) => ({
      testFile: r.test_file,
      testName: r.test_name,
      recentFails: Number(r.recent_fails),
      priorFails: Number(r.prior_fails),
      failureKinds: r.failure_kinds,
      lastErrorMessage: r.last_error_message,
      lastErrorStack: r.last_error_stack,
      lastFailed: r.last_failed.toISOString(),
    }))
  }

  async close(): Promise<void> {
    await this.sql.end()
  }
}
