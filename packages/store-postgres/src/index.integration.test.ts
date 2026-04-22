/**
 * Integration tests for PostgresStore.
 * Requires a running Postgres instance.
 *
 * Run locally:
 *   docker run -d --name ft-pg -e POSTGRES_PASSWORD=test -p 5432:5432 postgres:16
 *   INTEGRATION=1 POSTGRES_TEST_URL=postgres://postgres:test@localhost:5432/postgres bun test packages/store-postgres
 *
 * Or: bun run test:integration (with env vars set)
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type { FailureKind } from '@flaky-tests/core'
import { PostgresStore } from './index'

const SKIP = !process.env.INTEGRATION || !process.env.POSTGRES_TEST_URL
const CONNECTION_STRING = process.env.POSTGRES_TEST_URL ?? ''

// Use a unique prefix per run to avoid collisions
const PREFIX = `ft_test_${Date.now()}`

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400000)
}

function makeFailure(
  runId: string,
  testName: string,
  failedAt: Date,
  kind: FailureKind = 'assertion',
) {
  return {
    runId,
    testFile: 'tests/example.test.ts',
    testName,
    failureKind: kind,
    errorMessage: `${testName} failed`,
    errorStack: null,
    failedAt: failedAt.toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let store: PostgresStore

describe.skipIf(SKIP)('PostgresStore integration', () => {
  beforeAll(async () => {
    store = new PostgresStore({
      connectionString: CONNECTION_STRING,
      tablePrefix: PREFIX,
    })
    await store.migrate()
  })

  afterAll(async () => {
    // Clean up test tables
    if (store) {
      try {
        const postgres = (await import('postgres')).default
        const sql = postgres(CONNECTION_STRING)
        await sql`DROP TABLE IF EXISTS ${sql(`${PREFIX}_failures`)} CASCADE`
        await sql`DROP TABLE IF EXISTS ${sql(`${PREFIX}_runs`)} CASCADE`
        await sql.end()
      } catch {
        /* cleanup best-effort */
      }
      await store.close()
    }
  })

  test('migrate creates tables without error', async () => {
    // Already called in beforeAll — verify idempotent
    await store.migrate()
  })

  test('insertRun and updateRun complete without error', async () => {
    await store.insertRun({
      runId: 'pg-run-1',
      startedAt: new Date().toISOString(),
      gitSha: 'abc123',
      gitDirty: false,
      runtimeVersion: '1.3.0',
    })
    await store.updateRun('pg-run-1', {
      endedAt: new Date().toISOString(),
      status: 'fail',
      totalTests: 10,
      passedTests: 9,
      failedTests: 1,
    })
  })

  test('insertFailure records a failure', async () => {
    await store.insertRun({
      runId: 'pg-run-f',
      startedAt: new Date().toISOString(),
    })
    await store.updateRun('pg-run-f', {
      endedAt: new Date().toISOString(),
      status: 'fail',
      totalTests: 1,
      passedTests: 0,
      failedTests: 1,
    })
    await store.insertFailure(
      makeFailure('pg-run-f', 'test > fails', new Date()),
    )
  })

  test('insertFailures batch inserts in transaction', async () => {
    await store.insertRun({
      runId: 'pg-run-b',
      startedAt: new Date().toISOString(),
    })
    await store.updateRun('pg-run-b', {
      endedAt: new Date().toISOString(),
      status: 'fail',
      totalTests: 3,
      passedTests: 1,
      failedTests: 2,
    })
    await store.insertFailures([
      makeFailure('pg-run-b', 'test-a', new Date()),
      makeFailure('pg-run-b', 'test-b', new Date()),
    ])
  })

  test('getNewPatterns detects newly flaky test', async () => {
    await store.insertRun({
      runId: 'pg-det-1',
      startedAt: daysAgo(2).toISOString(),
    })
    await store.updateRun('pg-det-1', {
      endedAt: daysAgo(2).toISOString(),
      status: 'fail',
      totalTests: 5,
      passedTests: 3,
      failedTests: 2,
    })
    await store.insertFailure(
      makeFailure('pg-det-1', 'pg-auth > login', daysAgo(1)),
    )
    await store.insertFailure(
      makeFailure('pg-det-1', 'pg-auth > login', daysAgo(2)),
    )

    const patterns = await store.getNewPatterns({ windowDays: 7, threshold: 2 })
    const match = patterns.find(
      (pattern) => pattern.testName === 'pg-auth > login',
    )
    expect(match).toBeDefined()
    expect(match?.recentFails).toBe(2)
    expect(match?.priorFails).toBe(0)
  })

  test('getNewPatterns returns empty when no failures', async () => {
    // Create a clean store with fresh prefix to avoid other test data
    const cleanStore = new PostgresStore({
      connectionString: CONNECTION_STRING,
      tablePrefix: `${PREFIX}_clean`,
    })
    await cleanStore.migrate()
    const patterns = await cleanStore.getNewPatterns()
    expect(patterns).toEqual([])

    // Cleanup
    const postgres = (await import('postgres')).default
    const sql = postgres(CONNECTION_STRING)
    await sql`DROP TABLE IF EXISTS ${sql(`${PREFIX}_clean_failures`)} CASCADE`
    await sql`DROP TABLE IF EXISTS ${sql(`${PREFIX}_clean_runs`)} CASCADE`
    await sql.end()
    await cleanStore.close()
  })

  test('getNewPatterns returns failure kinds as array', async () => {
    await store.insertRun({
      runId: 'pg-kinds',
      startedAt: daysAgo(1).toISOString(),
    })
    await store.updateRun('pg-kinds', {
      endedAt: daysAgo(1).toISOString(),
      status: 'fail',
      totalTests: 3,
      passedTests: 1,
      failedTests: 2,
    })
    await store.insertFailure(
      makeFailure('pg-kinds', 'pg-kind-test', daysAgo(1), 'assertion'),
    )
    await store.insertFailure(
      makeFailure('pg-kinds', 'pg-kind-test', daysAgo(2), 'timeout'),
    )

    const patterns = await store.getNewPatterns({ threshold: 2 })
    const match = patterns.find(
      (pattern) => pattern.testName === 'pg-kind-test',
    )
    expect(match?.failureKinds.sort()).toEqual(['assertion', 'timeout'])
  })
})
