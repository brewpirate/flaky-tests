/**
 * Tiny leveled logger for flaky-tests diagnostics.
 *
 * Covers the "library code should fail loudly when something's actually broken
 * but stay quiet when everything's fine" case — stores and plugins use this
 * for their catch-block warn/error calls. CLI user output (pattern summaries,
 * `✓`/`✗` lines) is not logging and continues to use `console.*` directly.
 *
 * Level is resolved from `FLAKY_TESTS_LOG` on every log call so tests can
 * toggle it without re-importing the module. Per the project's convention,
 * logger code is the one place `process.env` may be read directly — it runs
 * before any config parsing.
 */

// biome-ignore-all lint/suspicious/noConsole: this is the logger — it owns console.*

/** Log severity. Levels are inclusive: `warn` emits warn+error, `debug` emits everything. */
export type LogLevel = 'silent' | 'error' | 'warn' | 'debug'

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  debug: 3,
}

const DEFAULT_LEVEL: LogLevel = 'warn'

/** Resolve the active level from env, falling back to the default. */
export function resolveLogLevel(): LogLevel {
  const value = process.env.FLAKY_TESTS_LOG?.toLowerCase()
  if (
    value === 'silent' ||
    value === 'error' ||
    value === 'warn' ||
    value === 'debug'
  ) {
    return value
  }
  return DEFAULT_LEVEL
}

export interface Logger {
  error(...args: unknown[]): void
  warn(...args: unknown[]): void
  debug(...args: unknown[]): void
}

/**
 * Create a namespaced logger. The namespace renders as `[flaky-tests:<namespace>]`
 * at the start of every line so messages from different subsystems are easy
 * to pick out in a noisy test run.
 */
export function createLogger(namespace: string): Logger {
  const prefix = `[flaky-tests:${namespace}]`
  const active = (level: LogLevel): boolean =>
    LEVEL_ORDER[level] <= LEVEL_ORDER[resolveLogLevel()]
  return {
    error: (...args) => {
      if (active('error')) console.error(prefix, ...args)
    },
    warn: (...args) => {
      if (active('warn')) console.warn(prefix, ...args)
    },
    debug: (...args) => {
      if (active('debug')) console.log(prefix, ...args)
    },
  }
}
