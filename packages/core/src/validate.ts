import { ValidationError } from './validate-schemas'

const TABLE_PREFIX_PATTERN = /^[a-z_][a-z0-9_]*$/

/**
 * Validates a SQL table name prefix.
 *
 * Interpolating a user-supplied string into a SQL identifier position
 * (e.g. `${prefix}_runs`) is a path to identifier injection — this guard
 * is the first line of defense; adapters should still quote identifiers.
 *
 * @throws {@link ValidationError} when `prefix` contains characters outside
 *   the safe identifier set `^[a-z_][a-z0-9_]*$`.
 */
export function validateTablePrefix(prefix: string): void {
  if (!TABLE_PREFIX_PATTERN.test(prefix)) {
    throw new ValidationError(
      `invalid tablePrefix: "${prefix}" — must match ${TABLE_PREFIX_PATTERN}`,
    )
  }
}
