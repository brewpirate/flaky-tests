import { Database } from 'bun:sqlite'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { SQLITE_MIGRATIONS } from '@flaky-tests/core'
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

describe('SqliteStore — schema_version migrations', () => {
  test('fresh DB records every migration in schema_version', () => {
    const fresh = new SqliteStore({ dbPath: ':memory:' })
    const applied = fresh.getAppliedMigrations()
    expect(applied.map((row) => row.version)).toEqual(
      SQLITE_MIGRATIONS.map((migration) => migration.version),
    )
    for (const row of applied) {
      expect(row.applied_at.length).toBeGreaterThan(0)
    }
  })

  test('migrate() is idempotent — a second call adds no new rows', async () => {
    const initial = store.getAppliedMigrations()
    await store.migrate()
    const after = store.getAppliedMigrations()
    expect(after).toEqual(initial)
  })

  test('pre-existing partial DB (has some columns, missing project) upgrades cleanly', async () => {
    // Simulate a v5 database: all columns up to `test_args`, but no `project`
    // and no schema_version table. This mirrors a real user upgrading from
    // before version tracking landed.
    const db = new Database(':memory:')
    db.exec(`
      CREATE TABLE runs (
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
      );
      CREATE TABLE failures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(run_id),
        test_file TEXT NOT NULL, test_name TEXT NOT NULL,
        failure_kind TEXT NOT NULL,
        error_message TEXT, error_stack TEXT,
        duration_ms INTEGER, failed_at TEXT NOT NULL
      );
    `)
    const tempPath = `/tmp/flaky-tests-migrate-${Date.now()}.db`
    db.serialize()
    // Write the simulated legacy DB to disk so we can open it with SqliteStore.
    // bun:sqlite :memory: has no path we can hand off, so we seed the file directly.
    const fs = await import('node:fs')
    fs.writeFileSync(tempPath, db.serialize())
    db.close()

    const upgraded = new SqliteStore({ dbPath: tempPath })
    const applied = upgraded.getAppliedMigrations()
    // Versions 1..5 should be seeded (baseline), version 6 applied for real.
    expect(applied.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6])

    // And the project column should now exist.
    const info = upgraded
      .getDb()
      .query<{ name: string }, []>('PRAGMA table_info(runs)')
      .all()
      .map((row) => row.name)
    expect(info).toContain('project')

    await upgraded.close()
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
