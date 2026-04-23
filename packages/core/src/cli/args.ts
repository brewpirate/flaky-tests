/**
 * Parses the `flaky-tests` CLI argv + env into a validated config object.
 *
 * Separating parsing from the main entry point lets tests drive the CLI
 * with controlled inputs (no `process.argv` leakage between tests) and
 * keeps `check.ts` small.
 */

import { type } from 'arktype'
import type { Config } from '../index'
import { ConfigError } from './errors'

/** Shape of validated CLI config. Consumed by the main entry point in `check.ts`. */
export const cliConfigSchema = type({
  help: 'boolean',
  version: 'boolean',
  windowDays: 'number > 0',
  threshold: 'number.integer > 0',
  showPrompts: 'boolean',
  doCopy: 'boolean',
  doCreateIssue: 'boolean',
  doHtml: 'boolean',
  'htmlOut?': 'string',
  'repo?': 'string',
})

export type CliConfig = typeof cliConfigSchema.infer

export interface ParseCliConfigOpts {
  argv: readonly string[]
  /** Fallback values when argv flags are absent — sourced from the resolved {@link Config}. */
  defaults: Pick<Config['detection'], 'windowDays' | 'threshold'>
}

/**
 * Parses argv into a validated {@link CliConfig}, falling back to defaults
 * from the resolved runtime config when flags are absent.
 *
 * Throws {@link ConfigError} (exit code 2) on invalid input so the caller
 * can surface a clean error without a stack trace.
 */
export function parseCliConfig(opts: ParseCliConfigOpts): CliConfig {
  const { argv, defaults } = opts

  const hasFlag = (name: string): boolean =>
    argv.includes(`--${name}`) || argv.includes(`-${name.charAt(0)}`)

  const option = (name: string): string | undefined => {
    const index = argv.indexOf(`--${name}`)
    if (index !== -1 && index + 1 < argv.length) {
      return argv[index + 1]
    }
    return undefined
  }

  const help = hasFlag('help')
  const version = hasFlag('version')

  const rawWindow = option('window')
  const rawThreshold = option('threshold')

  let windowDays: number
  if (rawWindow === undefined) {
    windowDays = defaults.windowDays
  } else {
    windowDays = Number(rawWindow)
    if (!Number.isFinite(windowDays) || windowDays <= 0) {
      throw new ConfigError(
        `--window must be a positive number, got "${rawWindow}"`,
      )
    }
  }

  let threshold: number
  if (rawThreshold === undefined) {
    threshold = defaults.threshold
  } else {
    threshold = Number(rawThreshold)
    if (
      !Number.isFinite(threshold) ||
      threshold <= 0 ||
      !Number.isInteger(threshold)
    ) {
      throw new ConfigError(
        `--threshold must be a positive integer, got "${rawThreshold}"`,
      )
    }
  }

  const doCopy = hasFlag('copy')
  const showPrompts = hasFlag('prompt') || doCopy

  const config = {
    help,
    version,
    windowDays,
    threshold,
    showPrompts,
    doCopy,
    doCreateIssue: hasFlag('create-issue'),
    doHtml: hasFlag('html'),
    ...(option('out') !== undefined && { htmlOut: option('out') }),
    ...(option('repo') !== undefined && { repo: option('repo') }),
  }

  const result = cliConfigSchema(config)
  if (result instanceof type.errors) {
    throw new ConfigError(`invalid CLI config: ${result.summary}`)
  }
  return result
}
