import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  FlakyPattern,
  GetNewPatternsOptions,
  HotFile,
  InsertFailureInput,
  InsertRunInput,
  IStore,
  KindBreakdown,
  RecentRun,
  UpdateRunInput,
} from '@flaky-tests/core'
import { coerceFailureKind, coerceFailureKinds, coerceRunStatus } from '@flaky-tests/core'

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

/**
 * Supabase-backed implementation of the {@link IStore} interface.
 * Persists test runs and failures to two Supabase tables.
 */
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

  /** Insert a new test run record. Throws on Supabase errors. */
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

  /**
   * Update an existing test run with final results.
   * @param runId - The run to update (matched via `run_id` column).
   * @param input - Fields to set (nulls are written explicitly).
   */
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

  /** Record a single test failure. `durationMs` is rounded to the nearest integer. */
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

  /**
   * Detect newly-flaky tests by comparing a recent window against a prior window.
   * Returns tests that failed >= `threshold` times recently but zero times in the
   * prior window, sorted by failure count descending. Only considers runs with
   * fewer than 10 total failures and a non-null `ended_at`.
   */
  async getNewPatterns(options: GetNewPatternsOptions = {}): Promise<FlakyPattern[]> {
    const windowDays = options.windowDays ?? 7
    const threshold = options.threshold ?? 2
    const now = Date.now()
    const windowStart = new Date(now - windowDays * 86400000).toISOString()
    const priorStart = new Date(now - windowDays * 2 * 86400000).toISOString()

    // Fetch failures from both windows in one query, filter to relevant runs
    const { data, error } = await this.client
      .from(this.failuresTable)
      .select(`run_id, test_file, test_name, failure_kind, error_message, error_stack, failed_at,
               ${this.runsTable}!inner(failed_tests, ended_at)`)
      .gt('failed_at', priorStart)
      .lt(`${this.runsTable}.failed_tests`, 10)
      .not(`${this.runsTable}.ended_at`, 'is', null)

    if (error) throw new Error(`[flaky-tests/store-supabase] getNewPatterns: ${error.message}`)

    type Row = { test_file: string; test_name: string; failure_kind: string; error_message: string | null; error_stack: string | null; failed_at: string }
    const rows = (data ?? []) as Row[]

    // Group and compute counts per test
    const map = new Map<string, { testFile: string; testName: string; recentFails: number; priorFails: number; kinds: Set<string>; lastMsg: string | null; lastStack: string | null; lastFailed: string }>()

    for (const row of rows) {
      const key = `${row.test_file}::${row.test_name}`
      if (!map.has(key)) {
        map.set(key, { testFile: row.test_file, testName: row.test_name, recentFails: 0, priorFails: 0, kinds: new Set(), lastMsg: null, lastStack: null, lastFailed: row.failed_at })
      }
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

    return [...map.values()]
      .filter((e) => e.recentFails >= threshold && e.priorFails === 0)
      .sort((a, b) => b.recentFails - a.recentFails)
      .map((e) => ({
        testFile: e.testFile,
        testName: e.testName,
        recentFails: e.recentFails,
        priorFails: e.priorFails,
        failureKinds: coerceFailureKinds([...e.kinds]),
        lastErrorMessage: e.lastMsg,
        lastErrorStack: e.lastStack,
        lastFailed: e.lastFailed,
      }))
  }

  async getRecentRuns(options: { limit?: number } = {}): Promise<RecentRun[]> {
    const limit = options.limit ?? 20
    const { data, error } = await this.client
      .from(this.runsTable)
      .select('run_id, started_at, ended_at, duration_ms, status, total_tests, passed_tests, failed_tests, errors_between_tests, git_sha, git_dirty')
      .order('started_at', { ascending: false })
      .limit(limit)

    if (error) throw new Error(`[flaky-tests/store-supabase] getRecentRuns: ${error.message}`)

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      runId: row.run_id as string,
      startedAt: row.started_at as string,
      endedAt: (row.ended_at as string) ?? null,
      durationMs: (row.duration_ms as number) ?? null,
      status: coerceRunStatus(row.status),
      totalTests: (row.total_tests as number) ?? null,
      passedTests: (row.passed_tests as number) ?? null,
      failedTests: (row.failed_tests as number) ?? null,
      errorsBetweenTests: (row.errors_between_tests as number) ?? null,
      gitSha: (row.git_sha as string) ?? null,
      gitDirty: row.git_dirty != null ? Boolean(row.git_dirty) : null,
    }))
  }

  async getFailureKindBreakdown(options: { windowDays?: number } = {}): Promise<KindBreakdown[]> {
    const windowDays = options.windowDays ?? 30
    const windowStart = new Date(Date.now() - windowDays * 86400000).toISOString()

    const { data, error } = await this.client
      .from(this.failuresTable)
      .select('failure_kind')
      .gt('failed_at', windowStart)

    if (error) throw new Error(`[flaky-tests/store-supabase] getFailureKindBreakdown: ${error.message}`)

    const counts = new Map<string, number>()
    for (const row of (data ?? []) as Array<{ failure_kind: string }>) {
      counts.set(row.failure_kind, (counts.get(row.failure_kind) ?? 0) + 1)
    }

    return [...counts.entries()]
      .map(([failureKind, count]) => ({ failureKind: coerceFailureKind(failureKind), count }))
      .sort((a, b) => b.count - a.count)
  }

  async getHotFiles(options: { windowDays?: number; limit?: number } = {}): Promise<HotFile[]> {
    const windowDays = options.windowDays ?? 30
    const limit = options.limit ?? 15
    const windowStart = new Date(Date.now() - windowDays * 86400000).toISOString()

    const { data, error } = await this.client
      .from(this.failuresTable)
      .select('test_file, test_name')
      .gt('failed_at', windowStart)

    if (error) throw new Error(`[flaky-tests/store-supabase] getHotFiles: ${error.message}`)

    const fileMap = new Map<string, { fails: number; tests: Set<string> }>()
    for (const row of (data ?? []) as Array<{ test_file: string; test_name: string }>) {
      if (!fileMap.has(row.test_file)) {
        fileMap.set(row.test_file, { fails: 0, tests: new Set() })
      }
      const entry = fileMap.get(row.test_file)!
      entry.fails++
      entry.tests.add(row.test_name)
    }

    return [...fileMap.entries()]
      .map(([testFile, v]) => ({ testFile, fails: v.fails, distinctTests: v.tests.size }))
      .sort((a, b) => b.fails - a.fails)
      .slice(0, limit)
  }

  async close(): Promise<void> {
    // Supabase JS client has no explicit close; connections are managed internally.
  }
}
