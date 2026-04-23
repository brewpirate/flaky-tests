import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SQLITE_MIGRATIONS, StoreError } from '@flaky-tests/core'
import {
  daysAgo,
  makeFailure,
  makeRun,
  runContractTests,
} from '@flaky-tests/core/test-helpers'
import { createClient } from '@libsql/client'
import { SqliteStore } from './index'

// Shared IStore contract — every adapter runs the same scenarios.
runContractTests('sqlite', async () => {
  const store = new SqliteStore({ dbPath: ':memory:' })
  await store.migrate()
  return store
})

// --- SqliteStore-specific supplements -----------------------------------
// These cover behaviour not in the IStore contract: reconcileRun, migration
// versioning on a pre-versioning legacy DB, and duplicate-insertRun PK
// violation semantics.

let store: SqliteStore

beforeEach(async () => {
  store = new SqliteStore({ dbPath: ':memory:' })
  await store.migrate()
})

afterEach(async () => {
  await store.close()
})

describe('SqliteStore — adapter-specific', () => {
  test('insertRun with a duplicate runId throws StoreError', async () => {
    await store.insertRun(makeRun('run-dup'))
    await expect(store.insertRun(makeRun('run-dup'))).rejects.toBeInstanceOf(
      StoreError,
    )
  })
})

describe('SqliteStore — schema_version migrations', () => {
  test('fresh DB records every migration in schema_version', async () => {
    const fresh = new SqliteStore({ dbPath: ':memory:' })
    await fresh.migrate()
    const applied = await fresh.getAppliedMigrations()
    expect(applied.map((row) => row.version)).toEqual(
      SQLITE_MIGRATIONS.map((migration) => migration.version),
    )
    for (const row of applied) {
      expect(row.applied_at.length).toBeGreaterThan(0)
    }
    await fresh.close()
  })

  test('migrate() is idempotent — a second call adds no new rows', async () => {
    const initial = await store.getAppliedMigrations()
    await store.migrate()
    const after = await store.getAppliedMigrations()
    expect(after).toEqual(initial)
  })

  test('pre-existing partial DB (has some columns, missing project) upgrades cleanly', async () => {
    // Seed a legacy v5-shape DB via libsql directly, skipping SqliteStore's
    // migrate(): columns up to `test_args` but no `project` and no
    // `schema_version` table. Mirrors a real user upgrading from a
    // pre-versioning install.
    const tempPath = `/tmp/flaky-tests-migrate-${Date.now()}.db`
    const seed = createClient({ url: `file:${tempPath}` })
    await seed.batch(
      [
        `CREATE TABLE runs (
          run_id               TEXT PRIMARY KEY,
          started_at           TEXT NOT NULL,
          ended_at             TEXT,
          duration_ms          INTEGER,
          status               TEXT,
          total_tests          INTEGER,
          passed_tests         INTEGER,
          failed_tests         INTEGER,
          errors_between_tests INTEGER,
          git_sha              TEXT,
          git_dirty            INTEGER,
          runtime_version      TEXT,
          test_args            TEXT
        )`,
        `CREATE TABLE failures (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          run_id TEXT NOT NULL REFERENCES runs(run_id),
          test_file TEXT NOT NULL, test_name TEXT NOT NULL,
          failure_kind TEXT NOT NULL,
          error_message TEXT, error_stack TEXT,
          duration_ms INTEGER, failed_at TEXT NOT NULL
        )`,
      ],
      'write',
    )
    seed.close()

    const upgraded = new SqliteStore({ dbPath: tempPath })
    await upgraded.migrate()
    const applied = await upgraded.getAppliedMigrations()
    // Versions 1..5 should be seeded (baseline), version 6 applied for real.
    expect(applied.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6])

    // And the project column should now exist.
    const info = await upgraded.getClient().execute('PRAGMA table_info(runs)')
    const columnNames = info.rows.map(
      (row) => (row as unknown as { name: string }).name,
    )
    expect(columnNames).toContain('project')

    await upgraded.close()
    const fs = await import('node:fs')
    fs.unlinkSync(tempPath)
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

    await store.reconcileRun('r1')

    const row = await store.getClient().execute({
      sql: 'SELECT status FROM runs WHERE run_id = ?',
      args: ['r1'],
    })
    const status = (row.rows[0] as unknown as { status: string }).status
    expect(status).toBe('fail')
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

    await store.reconcileRun('r1')

    const row = await store.getClient().execute({
      sql: 'SELECT status FROM runs WHERE run_id = ?',
      args: ['r1'],
    })
    const status = (row.rows[0] as unknown as { status: string }).status
    expect(status).toBe('fail')
  })

  test('does nothing for unknown runId', async () => {
    await expect(store.reconcileRun('no-such-run')).resolves.toBeUndefined()
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
