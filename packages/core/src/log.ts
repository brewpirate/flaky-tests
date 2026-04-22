/**
 * Tiny leveled logger for flaky-tests diagnostics.
 *
 * Covers the "library code should fail loudly when something's actually broken
 * but stay quiet when everything's fine" case — stores and plugins use this
 * for their catch-block warn/error calls. CLI user output (pattern summaries,
 * `✓`/`✗` lines) is not logging and continues to use `console.*` directly.
 *
 * Level is resolved from `resolveConfig()` on every log call so tests can
 * toggle it (via `resetConfigForTesting`) without re-importing the module.
 * If config resolution throws — e.g. the user set an invalid value — the
 * logger silently falls back to the default level so logging never crashes.
 */

// biome-ignore-all lint/suspicious/noConsole: this is the logger — it owns console.*

import { resolveConfig } from './config'

/** Log severity. Levels are inclusive: `warn` emits warn+error, `debug` emits everything. */
export type LogLevel = 'silent' | 'error' | 'warn' | 'debug'

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  debug: 3,
}

const DEFAULT_LEVEL: LogLevel = 'warn'

/** Resolve the active level from the unified config, falling back if config parsing fails so broken env never silences the logger. */
export function resolveLogLevel(): LogLevel {
  try {
    return resolveConfig().log.level
  } catch {
    return DEFAULT_LEVEL
  }
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
