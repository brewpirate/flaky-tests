/**
 * Separator used in the timestamp-prefix trick for MAX() aggregation.
 * CHAR(1) / chr(1) is a control character that won't appear in error messages.
 */
const TIMESTAMP_SEPARATOR = '\x01'

/**
 * Strips the `timestamp + CHAR(1)` prefix that the MAX()-based
 * "most recent payload" trick prepends to column values.
 *
 * Works regardless of timestamp format length (SQLite ISO 24-char,
 * Postgres timestamptz::text 32-char, etc.) by searching for the
 * CHAR(1) separator dynamically.
 */
export function stripTimestampPrefix(raw: string): string {
  const separatorIndex = raw.indexOf(TIMESTAMP_SEPARATOR)
  return separatorIndex !== -1 ? raw.slice(separatorIndex + 1) : raw
}
