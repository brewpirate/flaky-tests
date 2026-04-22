/**
 * Base class for CLI-originated errors. Carries an `exitCode` so the
 * top-level handler in `check.ts` can translate a thrown error into a
 * meaningful process exit without losing the error type or message.
 *
 * Default `exitCode` is 1. Subclasses override this to distinguish
 * failure modes (see {@link ConfigError}).
 *
 * @param message - Human-readable error message shown to the user
 * @param options - Optional `exitCode` override and `cause` for error chaining
 */
export class CliError extends Error {
  override readonly name: string = 'CliError'
  readonly exitCode: number
  constructor(
    message: string,
    options: { exitCode?: number; cause?: unknown } = {},
  ) {
    super(message, options.cause ? { cause: options.cause } : undefined)
    this.exitCode = options.exitCode ?? 1
  }
}

/**
 * Raised when CLI arguments or environment variables fail validation.
 * Uses exit code 2 to distinguish config errors from runtime failures —
 * matching the convention used by tools like `grep` and `rg`.
 *
 * Thrown by {@link parseCliConfig} (in `args.ts`) on any invalid input.
 */
export class ConfigError extends CliError {
  override readonly name = 'ConfigError'
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, { exitCode: 2, cause: options.cause })
  }
}
