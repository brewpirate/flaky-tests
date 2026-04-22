/**
 * Integration tests for TursoStore.
 * Uses file::memory: — no external service needed.
 *
 * Run: INTEGRATION=1 bun test packages/store-turso
 * Or:  bun run test:integration
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { FailureKind } from '@flaky-tests/core'
import { TursoStore } from './index'

const SKIP = !process.env.INTEGRATION
const TURSO_URL = process.env.TURSO_TEST_URL ?? 'file::memory:'

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

let store: TursoStore

describe.skipIf(SKIP)('TursoStore integration', () => {
  beforeEach(async () => {
    store = new TursoStore({ url: TURSO_URL })
    await store.migrate()
  })

  afterEach(async () => {
    await store.close()
  })

  test('migrate creates tables without error', async () => {
    // Already called in beforeEach — just verify no throw
    await store.migrate() // idempotent
  })

  test('insertRun and updateRun complete without error', async () => {
    await store.insertRun({
      runId: 'run-1',
      startedAt: new Date().toISOString(),
      gitSha: 'abc123',
      gitDirty: false,
      runtimeVersion: '1.3.0',
    })
    await store.updateRun('run-1', {
      endedAt: new Date().toISOString(),
      status: 'fail',
      totalTests: 10,
      passedTests: 9,
      failedTests: 1,
    })
  })

  test('insertFailure records a failure', async () => {
    await store.insertRun({
      runId: 'run-f',
      startedAt: new Date().toISOString(),
    })
    await store.updateRun('run-f', {
      endedAt: new Date().toISOString(),
      status: 'fail',
      totalTests: 1,
      passedTests: 0,
      failedTests: 1,
    })
    await store.insertFailure(makeFailure('run-f', 'test > fails', new Date()))
  })

  test('insertFailures batch inserts', async () => {
    await store.insertRun({
      runId: 'run-b',
      startedAt: new Date().toISOString(),
    })
    await store.updateRun('run-b', {
      endedAt: new Date().toISOString(),
      status: 'fail',
      totalTests: 3,
      passedTests: 1,
      failedTests: 2,
    })
    await store.insertFailures([
      makeFailure('run-b', 'test-a', new Date()),
      makeFailure('run-b', 'test-b', new Date()),
    ])
  })

  test('getNewPatterns detects newly flaky test', async () => {
    await store.insertRun({ runId: 'r1', startedAt: daysAgo(2).toISOString() })
    await store.updateRun('r1', {
      endedAt: daysAgo(2).toISOString(),
      status: 'fail',
      totalTests: 5,
      passedTests: 3,
      failedTests: 2,
    })
    await store.insertFailure(makeFailure('r1', 'auth > login', daysAgo(1)))
    await store.insertFailure(makeFailure('r1', 'auth > login', daysAgo(2)))

    const patterns = await store.getNewPatterns({ windowDays: 7, threshold: 2 })
    expect(patterns).toHaveLength(1)
    expect(patterns[0]?.testName).toBe('auth > login')
    expect(patterns[0]?.recentFails).toBe(2)
    expect(patterns[0]?.priorFails).toBe(0)
  })

  test('getNewPatterns excludes tests with prior failures', async () => {
    await store.insertRun({ runId: 'r1', startedAt: daysAgo(2).toISOString() })
    await store.updateRun('r1', {
      endedAt: daysAgo(2).toISOString(),
      status: 'fail',
      totalTests: 5,
      passedTests: 2,
      failedTests: 3,
    })
    await store.insertFailure(makeFailure('r1', 'auth > login', daysAgo(1)))
    await store.insertFailure(makeFailure('r1', 'auth > login', daysAgo(2)))
    await store.insertFailure(makeFailure('r1', 'auth > login', daysAgo(10))) // prior window

    const patterns = await store.getNewPatterns({ windowDays: 7, threshold: 2 })
    expect(patterns).toHaveLength(0)
  })

  test('getNewPatterns returns empty when no failures', async () => {
    const patterns = await store.getNewPatterns()
    expect(patterns).toEqual([])
  })

  test('getNewPatterns respects threshold', async () => {
    await store.insertRun({ runId: 'r1', startedAt: daysAgo(1).toISOString() })
    await store.updateRun('r1', {
      endedAt: daysAgo(1).toISOString(),
      status: 'fail',
      totalTests: 2,
      passedTests: 0,
      failedTests: 2,
    })
    await store.insertFailure(makeFailure('r1', 'flaky', daysAgo(1)))
    await store.insertFailure(makeFailure('r1', 'flaky', daysAgo(2)))

    expect(await store.getNewPatterns({ threshold: 3 })).toHaveLength(0)
    expect(await store.getNewPatterns({ threshold: 2 })).toHaveLength(1)
  })

  test('getNewPatterns collects failure kinds', async () => {
    await store.insertRun({ runId: 'r1', startedAt: daysAgo(1).toISOString() })
    await store.updateRun('r1', {
      endedAt: daysAgo(1).toISOString(),
      status: 'fail',
      totalTests: 3,
      passedTests: 1,
      failedTests: 2,
    })
    await store.insertFailure(
      makeFailure('r1', 'flaky', daysAgo(1), 'assertion'),
    )
    await store.insertFailure(makeFailure('r1', 'flaky', daysAgo(2), 'timeout'))

    const patterns = await store.getNewPatterns({ threshold: 2 })
    expect(patterns[0]?.failureKinds.sort()).toEqual(['assertion', 'timeout'])
  })

  test('getNewPatterns includes error message from most recent failure', async () => {
    await store.insertRun({ runId: 'r1', startedAt: daysAgo(2).toISOString() })
    await store.updateRun('r1', {
      endedAt: new Date().toISOString(),
      status: 'fail',
      totalTests: 2,
      passedTests: 0,
      failedTests: 2,
    })
    await store.insertFailure({
      runId: 'r1',
      testFile: 'f.test.ts',
      testName: 'flaky',
      failureKind: 'assertion',
      errorMessage: 'older error',
      errorStack: null,
      failedAt: daysAgo(2).toISOString(),
    })
    await store.insertFailure({
      runId: 'r1',
      testFile: 'f.test.ts',
      testName: 'flaky',
      failureKind: 'assertion',
      errorMessage: 'newer error',
      errorStack: null,
      failedAt: daysAgo(1).toISOString(),
    })

    const patterns = await store.getNewPatterns({ threshold: 2 })
    expect(patterns[0]?.lastErrorMessage).toBe('newer error')
  })
})
