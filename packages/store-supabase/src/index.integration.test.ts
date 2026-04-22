/**
 * Integration tests for SupabaseStore.
 * Requires a Supabase project with tables already created (migrate is a no-op verify).
 *
 * Run:
 *   INTEGRATION=1 \
 *   SUPABASE_TEST_URL=https://your-project.supabase.co \
 *   SUPABASE_TEST_KEY=your-anon-key \
 *   bun test packages/store-supabase
 *
 * Or: bun run test:integration (with env vars set)
 *
 * Table setup (run once in Supabase SQL editor):
 *   CREATE TABLE IF NOT EXISTS ft_integ_runs (
 *     run_id TEXT PRIMARY KEY, started_at TIMESTAMPTZ NOT NULL, ended_at TIMESTAMPTZ,
 *     duration_ms INTEGER, status TEXT, total_tests INTEGER, passed_tests INTEGER,
 *     failed_tests INTEGER, errors_between_tests INTEGER, git_sha TEXT,
 *     git_dirty BOOLEAN, runtime_version TEXT, test_args TEXT
 *   );
 *   CREATE TABLE IF NOT EXISTS ft_integ_failures (
 *     id SERIAL PRIMARY KEY, run_id TEXT NOT NULL REFERENCES ft_integ_runs(run_id),
 *     test_file TEXT NOT NULL, test_name TEXT NOT NULL, failure_kind TEXT NOT NULL,
 *     error_message TEXT, error_stack TEXT, duration_ms INTEGER, failed_at TIMESTAMPTZ NOT NULL
 *   );
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { getTestCredentials } from '@flaky-tests/core'
import {
  daysAgo,
  makeFailure,
  runContractTests,
} from '@flaky-tests/core/test-helpers'
import { SupabaseStore } from './index'

const credentials = getTestCredentials()
const SKIP =
  !credentials.integration ||
  !credentials.supabaseUrl ||
  !credentials.supabaseKey
const SUPABASE_URL = credentials.supabaseUrl ?? ''
const SUPABASE_KEY = credentials.supabaseKey ?? ''
const TABLE_PREFIX = 'ft_integ'

// Shared IStore contract — each test builds a fresh SupabaseStore against
// pre-created ft_integ_* tables; isolation is provided by per-test runIds
// generated inside the contract suite.
if (!SKIP) {
  runContractTests(
    'supabase',
    () =>
      new SupabaseStore({
        url: SUPABASE_URL,
        key: SUPABASE_KEY,
        tablePrefix: TABLE_PREFIX,
      }),
  )
}

// Unique run IDs per test run to avoid collisions
const RUN_PREFIX = `sb-${Date.now()}-`

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let store: SupabaseStore

describe.skipIf(SKIP)('SupabaseStore integration', () => {
  beforeAll(async () => {
    store = new SupabaseStore({
      url: SUPABASE_URL,
      key: SUPABASE_KEY,
      tablePrefix: TABLE_PREFIX,
    })
    await store.migrate()
  })

  afterAll(async () => {
    await store.close()
  })

  test('migrate verifies tables exist', async () => {
    await store.migrate() // idempotent — just checks tables
  })

  test('insertRun and updateRun complete without error', async () => {
    const runId = `${RUN_PREFIX}run-1`
    await store.insertRun({
      runId,
      startedAt: new Date().toISOString(),
      gitSha: 'abc123',
      gitDirty: false,
      runtimeVersion: '1.3.0',
    })
    await store.updateRun(runId, {
      endedAt: new Date().toISOString(),
      status: 'pass',
      totalTests: 10,
      passedTests: 10,
      failedTests: 0,
    })
  })

  test('insertFailure records a failure', async () => {
    const runId = `${RUN_PREFIX}run-f`
    await store.insertRun({ runId, startedAt: new Date().toISOString() })
    await store.updateRun(runId, {
      endedAt: new Date().toISOString(),
      status: 'fail',
      totalTests: 1,
      passedTests: 0,
      failedTests: 1,
    })
    await store.insertFailure(makeFailure(runId, 'sb-test > fails', new Date()))
  })

  test('insertFailures batch inserts', async () => {
    const runId = `${RUN_PREFIX}run-b`
    await store.insertRun({ runId, startedAt: new Date().toISOString() })
    await store.updateRun(runId, {
      endedAt: new Date().toISOString(),
      status: 'fail',
      totalTests: 3,
      passedTests: 1,
      failedTests: 2,
    })
    await store.insertFailures([
      makeFailure(runId, 'sb-test-a', new Date()),
      makeFailure(runId, 'sb-test-b', new Date()),
    ])
  })

  test('getNewPatterns detects newly flaky test', async () => {
    const runId = `${RUN_PREFIX}det`
    await store.insertRun({ runId, startedAt: daysAgo(2).toISOString() })
    await store.updateRun(runId, {
      endedAt: daysAgo(2).toISOString(),
      status: 'fail',
      totalTests: 5,
      passedTests: 3,
      failedTests: 2,
    })

    const testName = `sb-flaky-${Date.now()}`
    await store.insertFailure(makeFailure(runId, testName, daysAgo(1)))
    await store.insertFailure(makeFailure(runId, testName, daysAgo(2)))

    const patterns = await store.getNewPatterns({ windowDays: 7, threshold: 2 })
    const match = patterns.find((pattern) => pattern.testName === testName)
    expect(match).toBeDefined()
    expect(match?.recentFails).toBe(2)
  })

  test('getNewPatterns returns empty for clean window', async () => {
    // No recent failures for a unique test name
    const patterns = await store.getNewPatterns({
      windowDays: 7,
      threshold: 999,
    })
    expect(patterns).toEqual([])
  })
})
