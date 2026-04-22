import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { FailureKind } from '@flaky-tests/core'
import { SqliteStore } from './index'

// Helpers ----------------------------------------------------------------

function makeRun(runId: string, _failedTests = 1) {
  return {
    runId,
    startedAt: new Date().toISOString(),
  }
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

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86400000)
}

// Each test gets a fresh in-memory database
let store: SqliteStore

beforeEach(() => {
  store = new SqliteStore({ dbPath: ':memory:' })
})

afterEach(async () => {
  await store.close()
})

// Tests ------------------------------------------------------------------

describe('SqliteStore — basic operations', () => {
  test('inserts and closes without error', async () => {
    await store.insertRun(makeRun('run-1'))
    await store.updateRun('run-1', {
      endedAt: new Date().toISOString(),
      status: 'fail',
      totalTests: 10,
      passedTests: 9,
      failedTests: 1,
    })
    await store.insertFailure(makeFailure('run-1', 'auth > login', new Date()))
  })

  test('insertRun is idempotent for the same runId — second insert throws', async () => {
    await store.insertRun(makeRun('run-dup'))
    expect(() => store.insertRun(makeRun('run-dup'))).toThrow()
  })
})

describe('SqliteStore — getNewPatterns', () => {
  async function seedRun(
    runId: string,
    failures: Array<{
      name: string
      daysBack: number
      kind?: 'assertion' | 'timeout' | 'uncaught' | 'unknown'
    }>,
  ) {
    await store.insertRun({
      runId,
      startedAt: daysAgo(failures[0]?.daysBack ?? 0).toISOString(),
    })
    await store.updateRun(runId, {
      endedAt: new Date().toISOString(),
      status: 'fail',
      totalTests: failures.length + 5,
      passedTests: 5,
      failedTests: failures.length,
    })
    for (const f of failures) {
      await store.insertFailure(
        makeFailure(runId, f.name, daysAgo(f.daysBack), f.kind ?? 'assertion'),
      )
    }
  }

  test('returns empty when no failures exist', async () => {
    const patterns = await store.getNewPatterns()
    expect(patterns).toEqual([])
  })

  test('flags a test that crossed threshold in current window with no prior failures', async () => {
    await seedRun('run-a', [
      { name: 'auth > login', daysBack: 1 },
      { name: 'auth > login', daysBack: 2 },
    ])
    const patterns = await store.getNewPatterns({ windowDays: 7, threshold: 2 })
    expect(patterns).toHaveLength(1)
    expect(patterns[0]?.testName).toBe('auth > login')
    expect(patterns[0]?.recentFails).toBe(2)
    expect(patterns[0]?.priorFails).toBe(0)
  })

  test('does not flag a test below threshold', async () => {
    await seedRun('run-a', [{ name: 'auth > login', daysBack: 1 }])
    const patterns = await store.getNewPatterns({ windowDays: 7, threshold: 2 })
    expect(patterns).toHaveLength(0)
  })

  test('does not flag a test that also failed in the prior window', async () => {
    await seedRun('run-a', [
      { name: 'auth > login', daysBack: 1 }, // current window
      { name: 'auth > login', daysBack: 2 }, // current window
      { name: 'auth > login', daysBack: 10 }, // prior window (7-14 days ago)
    ])
    const patterns = await store.getNewPatterns({ windowDays: 7, threshold: 2 })
    expect(patterns).toHaveLength(0)
  })

  test('does not flag a test with failures only in the prior window', async () => {
    await seedRun('run-a', [
      { name: 'auth > login', daysBack: 10 },
      { name: 'auth > login', daysBack: 11 },
    ])
    const patterns = await store.getNewPatterns({ windowDays: 7, threshold: 2 })
    expect(patterns).toHaveLength(0)
  })

  test('returns multiple patterns sorted by recentFails descending', async () => {
    await seedRun('run-a', [
      { name: 'test-a', daysBack: 1 },
      { name: 'test-a', daysBack: 2 },
      { name: 'test-a', daysBack: 3 },
      { name: 'test-b', daysBack: 1 },
      { name: 'test-b', daysBack: 2 },
    ])
    const patterns = await store.getNewPatterns({ windowDays: 7, threshold: 2 })
    expect(patterns).toHaveLength(2)
    expect(patterns[0]?.testName).toBe('test-a')
    expect(patterns[0]?.recentFails).toBe(3)
    expect(patterns[1]?.testName).toBe('test-b')
    expect(patterns[1]?.recentFails).toBe(2)
  })

  test('respects custom threshold', async () => {
    await seedRun('run-a', [
      { name: 'flaky', daysBack: 1 },
      { name: 'flaky', daysBack: 2 },
    ])
    expect(await store.getNewPatterns({ threshold: 3 })).toHaveLength(0)
    expect(await store.getNewPatterns({ threshold: 2 })).toHaveLength(1)
    expect(await store.getNewPatterns({ threshold: 1 })).toHaveLength(1)
  })

  test('collects distinct failure kinds', async () => {
    await seedRun('run-a', [
      { name: 'flaky', daysBack: 1, kind: 'assertion' },
      { name: 'flaky', daysBack: 2, kind: 'timeout' },
    ])
    const patterns = await store.getNewPatterns({ threshold: 2 })
    expect(patterns[0]?.failureKinds.sort()).toEqual(['assertion', 'timeout'])
  })

  test('includes lastErrorMessage from the most recent failure in the current window', async () => {
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

  test('excludes runs where failed_tests >= 10 (whole-suite crash, not flakiness)', async () => {
    await store.insertRun({
      runId: 'r-crash',
      startedAt: daysAgo(1).toISOString(),
    })
    await store.updateRun('r-crash', {
      endedAt: new Date().toISOString(),
      status: 'fail',
      totalTests: 50,
      passedTests: 0,
      failedTests: 50,
    })
    await store.insertFailure(
      makeFailure('r-crash', 'auth > login', daysAgo(1)),
    )
    await store.insertFailure(
      makeFailure('r-crash', 'auth > login', daysAgo(2)),
    )

    const patterns = await store.getNewPatterns({ threshold: 2 })
    expect(patterns).toHaveLength(0)
  })
})

describe('SqliteStore — getFailuresByRun', () => {
  test('groups failures by runId in chronological order with coerced kind', async () => {
    await store.insertRun(makeRun('run-1'))
    await store.insertRun(makeRun('run-2'))
    const t0 = new Date('2026-04-01T10:00:00.000Z')
    const t1 = new Date('2026-04-01T10:00:01.000Z')
    const t2 = new Date('2026-04-01T10:00:02.000Z')
    const t3 = new Date('2026-04-01T10:00:03.000Z')
    await store.insertFailure(makeFailure('run-1', 'b-second', t1))
    await store.insertFailure(makeFailure('run-1', 'a-first', t0, 'timeout'))
    await store.insertFailure(makeFailure('run-2', 'x', t2))
    await store.insertFailure(makeFailure('run-2', 'y', t3, 'uncaught'))

    const result = await store.getFailuresByRun({
      runIds: ['run-1', 'run-2'],
    })
    expect(result.size).toBe(2)
    const r1 = result.get('run-1')
    const r2 = result.get('run-2')
    expect(r1).toHaveLength(2)
    expect(r2).toHaveLength(2)
    expect(r1?.[0]?.testName).toBe('a-first')
    expect(r1?.[0]?.failureKind).toBe('timeout')
    expect(r1?.[1]?.testName).toBe('b-second')
    expect(r2?.[1]?.failureKind).toBe('uncaught')
  })

  test('returns empty array for runIds with no failures', async () => {
    await store.insertRun(makeRun('run-empty'))
    const result = await store.getFailuresByRun({ runIds: ['run-empty'] })
    expect(result.size).toBe(1)
    expect(result.get('run-empty')).toEqual([])
  })
})

describe('SqliteStore — reconcileRun', () => {
  test('overrides status from pass to fail when exit code is non-zero', async () => {
    await store.insertRun({ runId: 'r1', startedAt: new Date().toISOString() })
    await store.updateRun('r1', {
      endedAt: new Date().toISOString(),
      status: 'pass',
      totalTests: 5,
      passedTests: 5,
      failedTests: 0,
    })

    store.reconcileRun('r1')

    const row = store
      .getDb()
      .query('SELECT status FROM runs WHERE run_id = ?')
      .get('r1') as { status: string }
    expect(row.status).toBe('fail')
  })

  test('does nothing when status is already fail', async () => {
    await store.insertRun({ runId: 'r1', startedAt: new Date().toISOString() })
    await store.updateRun('r1', {
      endedAt: new Date().toISOString(),
      status: 'fail',
      totalTests: 5,
      passedTests: 4,
      failedTests: 1,
    })

    store.reconcileRun('r1')

    const row = store
      .getDb()
      .query('SELECT status FROM runs WHERE run_id = ?')
      .get('r1') as { status: string }
    expect(row.status).toBe('fail')
  })

  test('does nothing for unknown runId', () => {
    expect(() => store.reconcileRun('no-such-run')).not.toThrow()
  })
})
