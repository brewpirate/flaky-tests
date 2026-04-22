import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  daysAgo,
  makeFailure,
  makeRun,
  runContractTests,
} from '@flaky-tests/core/test-helpers'
import { SqliteStore } from './index'

// Shared IStore contract — every adapter runs the same scenarios.
runContractTests('sqlite', () => new SqliteStore({ dbPath: ':memory:' }))

// --- SqliteStore-specific supplements -----------------------------------
// These cover behaviour not in the IStore contract: reconcileRun,
// getDb, and duplicate-insertRun PK violation semantics.

let store: SqliteStore

beforeEach(() => {
  store = new SqliteStore({ dbPath: ':memory:' })
})

afterEach(async () => {
  await store.close()
})

describe('SqliteStore — adapter-specific', () => {
  test('insertRun with a duplicate runId throws', async () => {
    await store.insertRun(makeRun('run-dup'))
    expect(() => store.insertRun(makeRun('run-dup'))).toThrow()
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

  test('helpers (daysAgo, makeFailure) round-trip a failure', async () => {
    await store.insertRun({ runId: 'r1', startedAt: new Date().toISOString() })
    await store.updateRun('r1', {
      endedAt: new Date().toISOString(),
      status: 'fail',
      totalTests: 1,
      passedTests: 0,
      failedTests: 1,
    })
    await store.insertFailure(makeFailure('r1', 'auth > login', daysAgo(0)))
  })
})
