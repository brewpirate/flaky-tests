/**
 * Tiny leveled logger for flaky-tests diagnostics.
 *
 * Covers the "library code should fail loudly when something's actually broken
 * but stay quiet when everything's fine" case — stores and plugins use this
 * for their catch-block warn/error calls. CLI user output (pattern summaries,
 * `✓`/`✗` lines) is not logging and continues to use `console.*` directly.
 *
 * Level and the optional file sink are resolved from `resolveConfig()` on
 * every log call so tests can toggle them (via `resetConfigForTesting`)
 * without re-importing the module. If config resolution throws — e.g. the
 * user set an invalid value — the logger silently falls back to the default
 * level and no file output so logging never crashes.
 */

// biome-ignore-all lint/suspicious/noConsole: this is the logger — it owns console.*

import { appendFileSync } from 'node:fs'
import type { Config } from './config'
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

/** Column width for the level token in file output — enough to right-pad `DEBUG`. */
const LEVEL_COLUMN_WIDTH = 5

/** Safely pull the log section from config, returning a stable default if resolution fails. */
function resolveLogConfig(): Config['log'] {
  try {
    return resolveConfig().log
  } catch {
    return { level: DEFAULT_LEVEL }
  }
}

/** Resolve the active level from the unified config, falling back if config parsing fails so broken env never silences the logger. */
export function resolveLogLevel(): LogLevel {
  return resolveLogConfig().level
}

export interface Logger {
  error(...args: unknown[]): void
  warn(...args: unknown[]): void
  debug(...args: unknown[]): void
}

/** Cheap stringifier for log args. Strings pass through; everything else
 *  goes through a defensive JSON attempt with `String()` as the last
 *  resort so circular references never crash the logger. */
function stringifyArg(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`
  }
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Format a single log line for the file sink. Timestamp first so `tail -f`
 *  is trivially usable and `grep` / `awk` can key off column 1. */
function formatFileLine(
  level: LogLevel,
  prefix: string,
  args: unknown[],
): string {
  const ts = new Date().toISOString()
  const body = args.map(stringifyArg).join(' ')
  return `${ts} ${level.toUpperCase().padEnd(LEVEL_COLUMN_WIDTH)} ${prefix} ${body}\n`
}

/** Append to the configured log file. Swallows write failures because a
 *  broken file sink must never mask the underlying event or crash the
 *  caller's control flow — diagnostic output is best-effort. */
function appendToFile(
  file: string,
  level: LogLevel,
  prefix: string,
  args: unknown[],
): void {
  try {
    appendFileSync(file, formatFileLine(level, prefix, args), 'utf8')
  } catch {
    // last-resort: ignore. File sink failure should not propagate.
  }
}

/**
 * Create a namespaced logger. The namespace renders as `[flaky-tests:<namespace>]`
 * at the start of every line so messages from different subsystems are easy
 * to pick out in a noisy test run.
 *
 * Each call emits to `console.{error,warn,log}`. When `config.log.file`
 * (set via `FLAKY_TESTS_LOG_FILE`) is configured, the same line is also
 * appended to that file with a timestamp — useful when the user-facing
 * console is crowded or piped elsewhere.
 */
export function createLogger(namespace: string): Logger {
  const prefix = `[flaky-tests:${namespace}]`

  function consoleSinkFor(level: LogLevel): (...args: unknown[]) => void {
    if (level === 'error') {
      return console.error
    }
    if (level === 'warn') {
      return console.warn
    }
    return console.log
  }

  function emit(level: LogLevel, args: unknown[]): void {
    const config = resolveLogConfig()
    if (LEVEL_ORDER[level] > LEVEL_ORDER[config.level]) {
      return
    }
    consoleSinkFor(level)(prefix, ...args)
    if (config.file !== undefined && config.file !== '') {
      appendToFile(config.file, level, prefix, args)
    }
  }

  return {
    error: (...args) => emit('error', args),
    warn: (...args) => emit('warn', args),
    debug: (...args) => emit('debug', args),
  }
}
