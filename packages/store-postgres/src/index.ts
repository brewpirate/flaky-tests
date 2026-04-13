import postgres from 'postgres'
import type {
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

  async close(): Promise<void> {
    await this.sql.end()
  }
}
