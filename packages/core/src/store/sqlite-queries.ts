/**
 * SQL strings + dynamic-clause builders shared by every libSQL-compatible
 * store (store-sqlite and store-turso today). Both adapters speak the
 * same dialect, so exporting the queries from one place keeps them from
 * drifting silently.
 *
 * Adapters still own driver-specific glue — argument coercion, `InArgs`
 * casts, retry/abort wrappers — but the query strings themselves come
 * from here. Builders are used for queries whose shape depends on
 * caller options (project filter, condition lists, LIMIT clause).
 */

import { MAX_FAILED_TESTS_PER_RUN } from '#core/config/defaults'
import { SCHEMA_VERSION_TABLE } from '#core/store/migrations'

// --- Schema version bookkeeping -----------------------------------------

/** Append a `schema_version` row recording that a migration landed. */
export const INSERT_SCHEMA_VERSION_SQL = `INSERT INTO ${SCHEMA_VERSION_TABLE} (version, applied_at) VALUES (?, ?)`

/** Look up the highest migration version the DB has ever applied. */
export const SELECT_CURRENT_VERSION_SQL = `SELECT MAX(version) AS version FROM ${SCHEMA_VERSION_TABLE}`

/** Full migration ledger for tooling/tests. */
export const SELECT_APPLIED_MIGRATIONS_SQL = `SELECT version, applied_at FROM ${SCHEMA_VERSION_TABLE} ORDER BY version ASC`

/** Enumerate user tables when probing a pre-versioning DB's schema. */
export const SELECT_USER_TABLES_SQL =
  "SELECT name FROM sqlite_master WHERE type = 'table'"

/** PRAGMA has no bind-parameter support — callers supply `tableName` from a trusted constant list. */
export function pragmaTableInfoSql(tableName: string): string {
  return `PRAGMA table_info(${tableName})`
}

// --- Writes -------------------------------------------------------------

export const INSERT_RUN_SQL = `INSERT INTO runs (run_id, project, started_at, git_sha, git_dirty, runtime_version, test_args)
              VALUES (?, ?, ?, ?, ?, ?, ?)`

export const UPDATE_RUN_SQL = `UPDATE runs
                 SET ended_at             = ?,
                     duration_ms          = ?,
                     status               = ?,
                     total_tests          = ?,
                     passed_tests         = ?,
                     failed_tests         = ?,
                     errors_between_tests = ?
               WHERE run_id = ?`

export const INSERT_FAILURE_SQL = `INSERT INTO failures
                (run_id, test_file, test_name, failure_kind,
                 error_message, error_stack, duration_ms, failed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`

// --- Reconcile (store-sqlite only, here so both adapters could share if needed) -

export const SELECT_RUN_STATUS_SQL = 'SELECT status FROM runs WHERE run_id = ?'

export const UPDATE_RUN_RECONCILE_SQL = `UPDATE runs
                 SET status               = 'fail',
                     errors_between_tests = COALESCE(errors_between_tests, 0) + 1
               WHERE run_id = ?`

// --- Read-side builders -------------------------------------------------

/**
 * Result envelope returned by each builder — a parameterised SQL string
 * plus the positional args the driver should bind.
 */
export interface ParameterizedQuery {
  sql: string
  args: (string | number)[]
}

/**
 * Build the newly-flaky detection query. Same detection rule every
 * adapter ships: recent-window failures in tests that had none in the
 * prior window of equal length, filtering out infrastructure blowups
 * (runs where ≥{@link MAX_FAILED_TESTS_PER_RUN} tests failed).
 */
export function buildNewPatternsQuery(opts: {
  windowDays: number
  threshold: number
  project: string | null
  now?: number
}): ParameterizedQuery {
  const { windowDays, threshold, project, now = Date.now() } = opts
  const MS_PER_DAY = 86_400_000
  const windowStart = new Date(now - windowDays * MS_PER_DAY).toISOString()
  const priorStart = new Date(now - windowDays * 2 * MS_PER_DAY).toISOString()
  const projectClause = project === null ? 'r.project IS NULL' : 'r.project = ?'
  const preFilterArgs: (string | number)[] = [
    windowStart,
    windowStart,
    priorStart,
    windowStart,
    windowStart,
    priorStart,
  ]
  const args: (string | number)[] =
    project === null
      ? [...preFilterArgs, threshold]
      : [...preFilterArgs, project, threshold]
  const sql = `SELECT
                 f.test_file,
                 f.test_name,
                 SUM(CASE WHEN f.failed_at > ?  THEN 1 ELSE 0 END) AS recent_fails,
                 SUM(CASE WHEN f.failed_at <= ? AND f.failed_at > ? THEN 1 ELSE 0 END) AS prior_fails,
                 GROUP_CONCAT(DISTINCT f.failure_kind) AS failure_kinds,
                 MAX(CASE WHEN f.failed_at > ? AND f.error_message IS NOT NULL
                          THEN f.failed_at || CHAR(1) || f.error_message END) AS last_error_message_raw,
                 MAX(CASE WHEN f.failed_at > ? AND f.error_stack IS NOT NULL
                          THEN f.failed_at || CHAR(1) || f.error_stack   END) AS last_error_stack_raw,
                 MAX(f.failed_at) AS last_failed
               FROM failures f
               JOIN runs r ON r.run_id = f.run_id
              WHERE r.failed_tests < ${MAX_FAILED_TESTS_PER_RUN}
                AND r.ended_at IS NOT NULL
                AND f.failed_at > ?
                AND ${projectClause}
              GROUP BY f.test_file, f.test_name
              HAVING recent_fails >= ? AND prior_fails = 0
              ORDER BY recent_fails DESC`
  return { sql, args }
}

/**
 * Build the most-recent-runs query. Same columns, ordering, and
 * `project IS NULL` vs `project = ?` handling across adapters.
 */
export function buildRecentRunsQuery(opts: {
  limit: number
  project?: string | null
}): ParameterizedQuery {
  const { limit, project = null } = opts
  const projectClause = project === null ? 'project IS NULL' : 'project = ?'
  const args: (string | number)[] =
    project === null ? [limit] : [project, limit]
  const sql = `SELECT run_id, project, started_at, ended_at, duration_ms, status,
                       total_tests, passed_tests, failed_tests,
                       errors_between_tests, git_sha, git_dirty
                  FROM runs
                 WHERE ${projectClause}
                 ORDER BY started_at DESC
                 LIMIT ?`
  return { sql, args }
}

/**
 * Build the raw failure-row listing. Handles the dynamic combination of
 * `since` / `runIds` / project filter / infra-blowup filter the same way
 * every adapter does, so the WHERE assembly doesn't drift between them.
 *
 * Returns an empty-args payload with the literal string `'EMPTY'` as the
 * SQL when `runIds` is an empty array — the adapter short-circuits on
 * that and never runs a query.
 */
export function buildListFailuresQuery(opts: {
  since?: string
  runIds?: readonly string[]
  project?: string | null
  excludeInfraBlowups?: boolean
}): ParameterizedQuery | { empty: true } {
  const { since, runIds, project = null, excludeInfraBlowups = true } = opts
  if (runIds !== undefined && runIds.length === 0) {
    return { empty: true }
  }

  const conditions: string[] = []
  const args: (string | number)[] = []

  if (since !== undefined) {
    conditions.push('f.failed_at > ?')
    args.push(since)
  }
  if (runIds !== undefined) {
    const placeholders = runIds.map(() => '?').join(', ')
    conditions.push(`f.run_id IN (${placeholders})`)
    args.push(...runIds)
  }
  if (project === null) {
    conditions.push('r.project IS NULL')
  } else {
    conditions.push('r.project = ?')
    args.push(project)
  }
  if (excludeInfraBlowups) {
    conditions.push(`r.failed_tests < ${MAX_FAILED_TESTS_PER_RUN}`)
    conditions.push('r.ended_at IS NOT NULL')
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
  const sql = `SELECT f.run_id, f.test_file, f.test_name, f.failure_kind,
                           f.error_message, f.failed_at
                      FROM failures f
                      JOIN runs r ON r.run_id = f.run_id
                      ${whereClause}
                     ORDER BY f.failed_at ASC`
  return { sql, args }
}
