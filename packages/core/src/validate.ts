const TABLE_PREFIX_PATTERN = /^[a-z_][a-z0-9_]*$/

/**
 * Validates a SQL table name prefix. Throws if the prefix contains
 * characters outside the safe identifier set `[a-z0-9_]`.
 */
export function validateTablePrefix(prefix: string): void {
  if (!TABLE_PREFIX_PATTERN.test(prefix)) {
    throw new Error(
      `invalid tablePrefix: "${prefix}" — must match ${TABLE_PREFIX_PATTERN}`,
    )
  }
}
