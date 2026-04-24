/**
 * Versioned-migration support shared by the SQLite-dialect stores
 * (store-sqlite and store-turso). Migrations are a monotonic array of
 * `{ version, up, probe }` records; adapters provide thin runners that
 * track applied versions in a `schema_version` table and apply pending
 * migrations transactionally.
 *
 * Design notes:
 * - The migration list is deliberately a flat array — version is the
 *   array index + 1, and new migrations append. This keeps version
 *   numbers contiguous and makes review easy.
 * - `probe` lets the runner seed a baseline for pre-existing databases
 *   that were created before we started recording versions: we walk the
 *   list in order and consider a migration "already applied" as long as
 *   its probe still passes on the live schema.
 * - The list is SQLite-dialect; postgres/supabase are out of scope (they
 *   use `CREATE TABLE IF NOT EXISTS` / manual Dashboard setup).
 */

/** Introspection callbacks the migration probes run against the live DB. */
export interface SchemaInspector {
  tableExists: (name: string) => boolean
  columnExists: (table: string, column: string) => boolean
}

/** Single versioned migration. `up` statements run in order, in one transaction. */
export interface SqliteMigration {
  version: number
  description: string
  up: readonly string[]
  /**
   * Returns true when the migration's effect is already visible on the live
   * schema. Used once, only for databases with no `schema_version` rows yet,
   * to infer a starting baseline without re-running DDL that would fail.
   */
  probe: (inspect: SchemaInspector) => boolean
}

/** Name of the table every adapter creates to record applied migrations. */
export const SCHEMA_VERSION_TABLE = 'schema_version'

/** DDL for the bookkeeping table. Adapters run this before anything else. */
export const CREATE_SCHEMA_VERSION_TABLE: string = `CREATE TABLE IF NOT EXISTS ${SCHEMA_VERSION_TABLE} (
  version     INTEGER PRIMARY KEY,
  applied_at  TEXT NOT NULL
)`

/**
 * Ordered migration list for SQLite-dialect adapters. Adding a migration
 * means appending a new entry with `version = previous + 1`; never reorder,
 * rewrite, or delete entries once they've shipped.
 */
export const SQLITE_MIGRATIONS: readonly SqliteMigration[] = [
  {
    version: 1,
    description: 'Create base runs + failures schema with indexes',
    up: [
      `CREATE TABLE IF NOT EXISTS runs (
        run_id         TEXT PRIMARY KEY,
        started_at     TEXT NOT NULL,
        ended_at       TEXT,
        duration_ms    INTEGER,
        status         TEXT,
        total_tests    INTEGER,
        failed_tests   INTEGER,
        git_sha        TEXT,
        git_dirty      INTEGER
      )`,
      `CREATE TABLE IF NOT EXISTS failures (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id         TEXT NOT NULL REFERENCES runs(run_id),
        test_file      TEXT NOT NULL,
        test_name      TEXT NOT NULL,
        failure_kind   TEXT NOT NULL,
        error_message  TEXT,
        error_stack    TEXT,
        duration_ms    INTEGER,
        failed_at      TEXT NOT NULL
      )`,
      'CREATE INDEX IF NOT EXISTS idx_failures_test      ON failures(test_file, test_name)',
      'CREATE INDEX IF NOT EXISTS idx_failures_run       ON failures(run_id)',
      'CREATE INDEX IF NOT EXISTS idx_failures_failed_at ON failures(failed_at)',
      'CREATE INDEX IF NOT EXISTS idx_runs_status        ON runs(ended_at, failed_tests)',
    ],
    probe: (inspect: SchemaInspector): boolean => inspect.tableExists('runs'),
  },
  {
    version: 2,
    description: 'Add runs.passed_tests',
    up: ['ALTER TABLE runs ADD COLUMN passed_tests INTEGER'],
    probe: (inspect: SchemaInspector): boolean =>
      inspect.columnExists('runs', 'passed_tests'),
  },
  {
    version: 3,
    description: 'Add runs.errors_between_tests',
    up: ['ALTER TABLE runs ADD COLUMN errors_between_tests INTEGER'],
    probe: (inspect: SchemaInspector): boolean =>
      inspect.columnExists('runs', 'errors_between_tests'),
  },
  {
    version: 4,
    description: 'Add runs.runtime_version',
    up: ['ALTER TABLE runs ADD COLUMN runtime_version TEXT'],
    probe: (inspect: SchemaInspector): boolean =>
      inspect.columnExists('runs', 'runtime_version'),
  },
  {
    version: 5,
    description: 'Add runs.test_args',
    up: ['ALTER TABLE runs ADD COLUMN test_args TEXT'],
    probe: (inspect: SchemaInspector): boolean =>
      inspect.columnExists('runs', 'test_args'),
  },
  {
    version: 6,
    description: 'Add runs.project',
    up: ['ALTER TABLE runs ADD COLUMN project TEXT'],
    probe: (inspect: SchemaInspector): boolean =>
      inspect.columnExists('runs', 'project'),
  },
]

/**
 * Walk `migrations` in version order and return the highest contiguous
 * version whose `probe` passes against the live schema. Used to seed a
 * baseline for databases that existed before we introduced
 * `schema_version`. Returns `0` when no migrations have been applied yet
 * (fresh database).
 */
export function detectBaselineVersion(
  migrations: readonly SqliteMigration[],
  inspect: SchemaInspector,
): number {
  let baseline = 0
  for (const migration of migrations) {
    if (!migration.probe(inspect)) {
      break
    }
    baseline = migration.version
  }
  return baseline
}

/** Filter to migrations that still need to run given the current applied version. */
export function pendingMigrations(
  migrations: readonly SqliteMigration[],
  currentVersion: number,
): readonly SqliteMigration[] {
  return migrations.filter((migration) => migration.version > currentVersion)
}
