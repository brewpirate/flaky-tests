import { describe, expect, test } from 'bun:test'
import {
  detectBaselineVersion,
  pendingMigrations,
  type SchemaInspector,
  SQLITE_MIGRATIONS,
  type SqliteMigration,
} from './migrations'

/** Build a stub inspector from a table->columns map. */
function makeInspector(
  tables: Record<string, readonly string[]>,
): SchemaInspector {
  return {
    tableExists: (name) => Object.hasOwn(tables, name),
    columnExists: (table, column) =>
      Object.hasOwn(tables, table) && tables[table]?.includes(column) === true,
  }
}

describe('SQLITE_MIGRATIONS', () => {
  test('versions are contiguous starting at 1', () => {
    for (const [index, migration] of SQLITE_MIGRATIONS.entries()) {
      expect(migration.version).toBe(index + 1)
    }
  })

  test('every migration has at least one up statement', () => {
    for (const migration of SQLITE_MIGRATIONS) {
      expect(migration.up.length).toBeGreaterThan(0)
    }
  })

  test('every migration has a non-empty description', () => {
    for (const migration of SQLITE_MIGRATIONS) {
      expect(migration.description.length).toBeGreaterThan(0)
    }
  })
})

describe('detectBaselineVersion', () => {
  test('returns 0 for a fresh database (no runs table)', () => {
    const inspect = makeInspector({})
    expect(detectBaselineVersion(SQLITE_MIGRATIONS, inspect)).toBe(0)
  })

  test('returns 1 for a database with only the base schema', () => {
    const inspect = makeInspector({
      runs: ['run_id', 'started_at'],
      failures: ['id'],
    })
    expect(detectBaselineVersion(SQLITE_MIGRATIONS, inspect)).toBe(1)
  })

  test('returns 5 when test_args is present but project is not', () => {
    const inspect = makeInspector({
      runs: [
        'run_id',
        'started_at',
        'passed_tests',
        'errors_between_tests',
        'runtime_version',
        'test_args',
      ],
      failures: ['id'],
    })
    expect(detectBaselineVersion(SQLITE_MIGRATIONS, inspect)).toBe(5)
  })

  test('returns the max version when every probe passes', () => {
    const inspect = makeInspector({
      runs: [
        'run_id',
        'started_at',
        'passed_tests',
        'errors_between_tests',
        'runtime_version',
        'test_args',
        'project',
      ],
      failures: ['id'],
    })
    expect(detectBaselineVersion(SQLITE_MIGRATIONS, inspect)).toBe(
      SQLITE_MIGRATIONS.length,
    )
  })

  test('stops at the first probe that fails — does not resume downstream', () => {
    // Columns present AFTER the gap should not advance the baseline:
    // project exists but passed_tests is missing. Baseline must be 1
    // because v2's probe fails and we never resume.
    const inspect = makeInspector({
      runs: ['run_id', 'started_at', 'project'],
      failures: ['id'],
    })
    expect(detectBaselineVersion(SQLITE_MIGRATIONS, inspect)).toBe(1)
  })
})

describe('pendingMigrations', () => {
  test('returns all migrations when current version is 0', () => {
    const result = pendingMigrations(SQLITE_MIGRATIONS, 0)
    expect(result.length).toBe(SQLITE_MIGRATIONS.length)
  })

  test('returns none when current version is at or above max', () => {
    const max = SQLITE_MIGRATIONS.length
    expect(pendingMigrations(SQLITE_MIGRATIONS, max).length).toBe(0)
    expect(pendingMigrations(SQLITE_MIGRATIONS, max + 10).length).toBe(0)
  })

  test('returns only later migrations when partially applied', () => {
    const result = pendingMigrations(SQLITE_MIGRATIONS, 3)
    expect(result.map((migration) => migration.version)).toEqual([4, 5, 6])
  })
})

describe('custom migration arrays', () => {
  // Sanity check: the helpers work on any migration list, not just the
  // built-in one. Guards against accidentally hardcoding the global.
  const synthetic: readonly SqliteMigration[] = [
    {
      version: 1,
      description: 'create widgets',
      up: ['CREATE TABLE widgets (id INTEGER)'],
      probe: (inspect) => inspect.tableExists('widgets'),
    },
    {
      version: 2,
      description: 'add widgets.color',
      up: ['ALTER TABLE widgets ADD COLUMN color TEXT'],
      probe: (inspect) => inspect.columnExists('widgets', 'color'),
    },
  ]

  test('detects baseline on a custom list', () => {
    const inspect = makeInspector({ widgets: ['id'] })
    expect(detectBaselineVersion(synthetic, inspect)).toBe(1)
  })

  test('filters pending on a custom list', () => {
    expect(pendingMigrations(synthetic, 1).map((m) => m.version)).toEqual([2])
  })
})
