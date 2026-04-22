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

const log = createLogger('store-supabase')

/** Configuration for the Supabase store. */
export const supabaseStoreOptionsSchema = type({
  url: type.string.atLeastLength(1),
  key: type.string.atLeastLength(1),
  'tablePrefix?': 'string',
})

/** Validated options accepted by {@link SupabaseStore}. Inferred from the ArkType schema so runtime and compile-time stay aligned. */
export type SupabaseStoreOptions = typeof supabaseStoreOptionsSchema.infer

const PACKAGE = '@flaky-tests/store-supabase'

/**
 * Supabase-backed {@link IStore} implementation. Uses the supabase-js client against a
 * hosted Supabase/Postgres instance, so a project URL and API key (anon or service role)
 * must be supplied via config/env. Persists runs and failures to two prefixed tables.
 */
export class SupabaseStore implements IStore {
  private client: SupabaseClient
  private runsTable: string
  private failuresTable: string

  /** Validate options, construct a supabase-js client, and resolve the runs/failures table names from `tablePrefix` (default `flaky_test`). */
  constructor(options: SupabaseStoreOptions) {
    const validated = parse(supabaseStoreOptionsSchema, options)
    // Validate the prefix before creating any client — a malicious prefix
    // should short-circuit with no observable side effects.
    const prefix = validated.tablePrefix ?? 'flaky_test'
    validateTablePrefix(prefix)
    this.runsTable = `${prefix}_runs`
    this.failuresTable = `${prefix}_failures`
    this.client = createClient(validated.url, validated.key)
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

  /** Insert a new run row at the start of a test session so failures can reference it via `run_id`. */
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

    const patterns = parseArray(
      flakyPatternSchema,
      [...map.values()]
        .filter(
          (entry) => entry.recentFails >= threshold && entry.priorFails === 0,
        )
        .sort((a, b) => b.recentFails - a.recentFails)
        .map((entry) => ({
          testFile: entry.testFile,
          testName: entry.testName,
          recentFails: entry.recentFails,
          priorFails: entry.priorFails,
          failureKinds: [...entry.kinds],
          lastErrorMessage: entry.lastMsg,
          lastErrorStack: entry.lastStack,
          lastFailed: entry.lastFailed,
        })),
    )
    log.debug(
      `getNewPatterns: windowDays=${windowDays}, threshold=${threshold}, returned=${patterns.length} patterns`,
    )
    return patterns
  }

  /** No-op: the supabase-js client manages its HTTP connections internally and needs no teardown. Present to satisfy {@link IStore}. */
  async close(): Promise<void> {
    // Supabase JS client has no explicit close; connections are managed internally.
  }
}

/** Lazy plugin descriptor — `create(config)` builds a SupabaseStore from the resolved config. */
export const supabaseStorePlugin = definePlugin({
  name: 'store-supabase',
  configSchema: supabaseStoreOptionsSchema,
  create(config: Config): SupabaseStore {
    if (config.store.type !== 'supabase') {
      throw new Error(
        `store-supabase plugin invoked with config.store.type="${config.store.type}"`,
      )
    }
    return new SupabaseStore({
      url: config.store.url,
      key: config.store.key,
      ...(config.store.tablePrefix !== undefined && {
        tablePrefix: config.store.tablePrefix,
      }),
    })
  },
})
