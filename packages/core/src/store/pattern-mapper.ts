import { stripTimestampPrefix } from './store-utils'
import type { FlakyPattern } from '#core/types'

/**
 * Raw row shape returned by the getNewPatterns query across all SQL stores.
 * Field types vary by driver — all values are coerced during mapping.
 */
export interface PatternRow {
  test_file: unknown
  test_name: unknown
  recent_fails: unknown
  prior_fails: unknown
  /** Comma-separated string (SQLite/Turso) or string array (Postgres). */
  failure_kinds: unknown
  last_error_message_raw: unknown
  last_error_stack_raw: unknown
  /** String (SQLite/Turso) or Date (Postgres). */
  last_failed: unknown
}

/**
 * Maps a raw database row to a FlakyPattern, handling type coercion differences
 * across SQLite, Turso, and Postgres drivers.
 */
export function mapRowToPattern(row: PatternRow): FlakyPattern {
  const failureKinds = Array.isArray(row.failure_kinds)
    ? (row.failure_kinds.map(String) as FlakyPattern['failureKinds'])
    : (String(row.failure_kinds).split(',') as FlakyPattern['failureKinds'])

  const lastFailed =
    row.last_failed instanceof Date
      ? row.last_failed.toISOString()
      : String(row.last_failed)

  return {
    testFile: String(row.test_file),
    testName: String(row.test_name),
    recentFails: Number(row.recent_fails),
    priorFails: Number(row.prior_fails),
    failureKinds,
    lastErrorMessage:
      row.last_error_message_raw != null
        ? stripTimestampPrefix(String(row.last_error_message_raw))
        : null,
    lastErrorStack:
      row.last_error_stack_raw != null
        ? stripTimestampPrefix(String(row.last_error_stack_raw))
        : null,
    lastFailed,
  }
}
