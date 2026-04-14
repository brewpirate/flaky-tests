import {
  DEFAULT_THRESHOLD,
  DEFAULT_WINDOW_DAYS,
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
  parse,
  parseArray,
  StoreError,
  type UpdateRunInput,
  updateRunInputSchema,
  validateTablePrefix,
} from '@flaky-tests/core'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@supabase/supabase-js'
import { type } from 'arktype'

/** Configuration for the Supabase store. */
export const supabaseStoreOptionsSchema = type({
  url: type.string.atLeastLength(1),
  key: type.string.atLeastLength(1),
  'tablePrefix?': 'string',
})

export type SupabaseStoreOptions = typeof supabaseStoreOptionsSchema.infer

/**
 * Supabase-backed implementation of the {@link IStore} interface.
 * Persists test runs and failures to two Supabase tables.
 */
const PACKAGE = '@flaky-tests/store-supabase'

export class SupabaseStore implements IStore {
  private client: SupabaseClient
  private runsTable: string
  private failuresTable: string

  constructor(options: SupabaseStoreOptions) {
    const validated = parse(supabaseStoreOptionsSchema, options)
    this.client = createClient(validated.url, validated.key)
    const prefix = validated.tablePrefix ?? 'flaky_test'
    validateTablePrefix(prefix)
    this.runsTable = `${prefix}_runs`
    this.failuresTable = `${prefix}_failures`
  }

  /**
   * Supabase does not support DDL through the JS client.
   * Tables must be created via the Supabase Dashboard SQL editor or migrations.
   * See the docs for the required schema: https://brewpirate.github.io/flaky-tests/stores/supabase/
   */
  async migrate(): Promise<void> {
    // Verify tables exist by attempting a lightweight query
    const { error } = await this.client
      .from(this.runsTable)
      .select('run_id')
      .limit(0)
    if (error) {
      throw new StoreError({
        package: PACKAGE,
        method: 'migrate',
        message: `table "${this.runsTable}" not found — Supabase requires manual table creation. See https://brewpirate.github.io/flaky-tests/stores/supabase/`,
        cause: error,
      })
    }
  }

  /** Insert a new test run record. Throws on Supabase errors. */
  async insertRun(input: InsertRunInput): Promise<void> {
    parse(insertRunInputSchema, input)
    const { error } = await this.client.from(this.runsTable).insert({
      run_id: input.runId,
      started_at: input.startedAt,
      git_sha: input.gitSha ?? null,
      git_dirty: input.gitDirty ?? null,
      runtime_version: input.runtimeVersion ?? null,
      test_args: input.testArgs ?? null,
    })
    if (error)
      throw new StoreError({
        package: PACKAGE,
        method: 'insertRun',
        message: error.message,
        cause: error,
      })
  }

  /**
   * Update an existing test run with final results.
   * @param runId - The run to update (matched via `run_id` column).
   * @param input - Fields to set (nulls are written explicitly).
   */
  async updateRun(runId: string, input: UpdateRunInput): Promise<void> {
    parse(updateRunInputSchema, input)
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
    if (error)
      throw new StoreError({
        package: PACKAGE,
        method: 'updateRun',
        message: error.message,
        cause: error,
      })
  }

  /** Record a single test failure. `durationMs` is rounded to the nearest integer. */
  async insertFailure(input: InsertFailureInput): Promise<void> {
    parse(insertFailureInputSchema, input)
    const { error } = await this.client.from(this.failuresTable).insert({
      run_id: input.runId,
      test_file: input.testFile,
      test_name: input.testName,
      failure_kind: input.failureKind,
      error_message: input.errorMessage ?? null,
      error_stack: input.errorStack ?? null,
      duration_ms:
        input.durationMs != null ? Math.round(input.durationMs) : null,
      failed_at: input.failedAt,
    })
    if (error)
      throw new StoreError({
        package: PACKAGE,
        method: 'insertFailure',
        message: error.message,
        cause: error,
      })
  }

  /**
   * Insert multiple failures. Supabase does not support transactions through the
   * JS client, so this uses a single bulk insert call for atomicity at the REST level.
   */
  async insertFailures(inputs: readonly InsertFailureInput[]): Promise<void> {
    if (inputs.length === 0) return
    const rows = inputs.map((input) => {
      parse(insertFailureInputSchema, input)
      return {
        run_id: input.runId,
        test_file: input.testFile,
        test_name: input.testName,
        failure_kind: input.failureKind,
        error_message: input.errorMessage ?? null,
        error_stack: input.errorStack ?? null,
        duration_ms:
          input.durationMs != null ? Math.round(input.durationMs) : null,
        failed_at: input.failedAt,
      }
    })
    const { error } = await this.client.from(this.failuresTable).insert(rows)
    if (error)
      throw new StoreError({
        package: PACKAGE,
        method: 'insertFailures',
        message: error.message,
        cause: error,
      })
  }

  /**
   * Detect newly-flaky tests by comparing a recent window against a prior window.
   * Returns tests that failed >= `threshold` times recently but zero times in the
   * prior window, sorted by failure count descending. Only considers runs with
   * fewer than 10 total failures and a non-null `ended_at`.
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

    // Fetch failures from both windows in one query, filter to relevant runs
    const { data, error } = await this.client
      .from(this.failuresTable)
      .select(`run_id, test_file, test_name, failure_kind, error_message, error_stack, failed_at,
               ${this.runsTable}!inner(failed_tests, ended_at)`)
      .gt('failed_at', priorStart)
      .lt(`${this.runsTable}.failed_tests`, MAX_FAILED_TESTS_PER_RUN)
      .not(`${this.runsTable}.ended_at`, 'is', null)

    if (error)
      throw new StoreError({
        package: PACKAGE,
        method: 'getNewPatterns',
        message: error.message,
        cause: error,
      })

    type Row = {
      test_file: string
      test_name: string
      failure_kind: string
      error_message: string | null
      error_stack: string | null
      failed_at: string
    }
    // Supabase client returns typed JSON but the generic is too wide — Row matches the select columns above
    const rows = (data ?? []) as unknown as Row[]

    // Group and compute counts per test
    const map = new Map<
      string,
      {
        testFile: string
        testName: string
        recentFails: number
        priorFails: number
        kinds: Set<string>
        lastMsg: string | null
        lastStack: string | null
        lastFailed: string
      }
    >()

    for (const row of rows) {
      const key = `${row.test_file}::${row.test_name}`
      if (!map.has(key)) {
        map.set(key, {
          testFile: row.test_file,
          testName: row.test_name,
          recentFails: 0,
          priorFails: 0,
          kinds: new Set(),
          lastMsg: null,
          lastStack: null,
          lastFailed: row.failed_at,
        })
      }
      // biome-ignore lint/style/noNonNullAssertion: key is guaranteed to exist — set on the line above
      const entry = map.get(key)!
      if (row.failed_at > windowStart) {
        entry.recentFails++
        entry.kinds.add(row.failure_kind)
        if (row.failed_at > entry.lastFailed) {
          entry.lastFailed = row.failed_at
          entry.lastMsg = row.error_message
          entry.lastStack = row.error_stack
        }
      } else {
        entry.priorFails++
      }
    }

    return parseArray(
      flakyPatternSchema,
      [...map.values()]
        .filter((e) => e.recentFails >= threshold && e.priorFails === 0)
        .sort((a, b) => b.recentFails - a.recentFails)
        .map((e) => ({
          testFile: e.testFile,
          testName: e.testName,
          recentFails: e.recentFails,
          priorFails: e.priorFails,
          failureKinds: [...e.kinds],
          lastErrorMessage: e.lastMsg,
          lastErrorStack: e.lastStack,
          lastFailed: e.lastFailed,
        })),
    )
  }

  async close(): Promise<void> {
    // Supabase JS client has no explicit close; connections are managed internally.
  }
}
