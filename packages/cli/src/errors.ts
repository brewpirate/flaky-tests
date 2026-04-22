/**
 * Typed error classes for the `flaky-tests` CLI.
 *
 * The top-level `main()` catches these and maps them to process exit codes
 * so callers (CI pipelines) get a stable signal.
 */

/** A CLI error the user should see. Default exit code: 1. */
export class CliError extends Error {
  readonly exitCode: number
  constructor(message: string, exitCode = 1) {
    super(message)
    this.name = 'CliError'
    this.exitCode = exitCode
  }
}

/** A configuration problem (bad flag, invalid env var). Exit code: 2. */
export class ConfigError extends CliError {
  constructor(message: string) {
    super(message, 2)
    this.name = 'ConfigError'
  }
}
