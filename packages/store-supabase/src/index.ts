import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  InsertFailureInput,
  InsertRunInput,
  IStore,
  UpdateRunInput,
} from '@flaky-tests/core'

export interface SupabaseStoreOptions {
  /** Supabase project URL */
  url: string
  /** Supabase anon or service role key */
  key: string
  /**
   * Table name prefix. Defaults to `flaky_test`, producing tables
   * `flaky_test_runs` and `flaky_test_failures`.
   */
  tablePrefix?: string
}

export class SupabaseStore implements IStore {
  private client: SupabaseClient
  private runsTable: string
  private failuresTable: string

  constructor(options: SupabaseStoreOptions) {
    this.client = createClient(options.url, options.key)
    const prefix = options.tablePrefix ?? 'flaky_test'
    this.runsTable = `${prefix}_runs`
    this.failuresTable = `${prefix}_failures`
  }

  async insertRun(input: InsertRunInput): Promise<void> {
    const { error } = await this.client.from(this.runsTable).insert({
      run_id: input.runId,
      started_at: input.startedAt,
      git_sha: input.gitSha ?? null,
      git_dirty: input.gitDirty ?? null,
      runtime_version: input.runtimeVersion ?? null,
      test_args: input.testArgs ?? null,
    })
    if (error) throw new Error(`[flaky-tests/store-supabase] insertRun: ${error.message}`)
  }

  async updateRun(runId: string, input: UpdateRunInput): Promise<void> {
    const { error } = await this.client
      .from(this.runsTable)
      .update({
        ended_at: input.endedAt ?? null,
        duration_ms: input.durationMs ?? null,
        status: input.status ?? null,
        total_tests: input.totalTests ?? null,
        passed_tests: input.passedTests ?? null,
        failed_tests: input.failedTests ?? null,
        errors_between_tests: input.errorsBetweenTests ?? null,
      })
      .eq('run_id', runId)
    if (error) throw new Error(`[flaky-tests/store-supabase] updateRun: ${error.message}`)
  }

  async insertFailure(input: InsertFailureInput): Promise<void> {
    const { error } = await this.client.from(this.failuresTable).insert({
      run_id: input.runId,
      test_file: input.testFile,
      test_name: input.testName,
      failure_kind: input.failureKind,
      error_message: input.errorMessage ?? null,
      error_stack: input.errorStack ?? null,
      duration_ms: input.durationMs != null ? Math.round(input.durationMs) : null,
      failed_at: input.failedAt,
    })
    if (error) throw new Error(`[flaky-tests/store-supabase] insertFailure: ${error.message}`)
  }

  async close(): Promise<void> {
    // Supabase JS client has no explicit close; connections are managed internally.
  }
}
