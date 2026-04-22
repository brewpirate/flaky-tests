/**
 * Unified runtime configuration for flaky-tests.
 *
 * This module is the ONLY place in the codebase that reads `process.env`.
 * Every other caller goes through `resolveConfig()`. One narrow exception
 * lives in `plugin-bun/src/run-tracked.ts`, which *writes* FLAKY_TESTS_RUN_ID
 * as IPC to its `bun test` child — that is not a config read.
 */

import { type } from 'arktype'
import { ConfigError } from './errors'
import { parse } from './validate-schemas'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const logLevel = type("'silent' | 'error' | 'warn' | 'debug'")

const sqliteStoreConfigSchema = type({
  type: "'sqlite'",
  'path?': 'string',
})

const tursoStoreConfigSchema = type({
  type: "'turso'",
  url: type.string.atLeastLength(1),
  'authToken?': 'string',
})

const supabaseStoreConfigSchema = type({
  type: "'supabase'",
  url: type.string.atLeastLength(1),
  key: type.string.atLeastLength(1),
  'tablePrefix?': 'string',
})

const postgresStoreConfigSchema = type({
  type: "'postgres'",
  'connectionString?': 'string',
  'host?': 'string',
  'port?': 'number.integer > 0',
  'database?': 'string',
  'username?': 'string',
  'password?': 'string',
  'ssl?': "boolean | 'require' | 'prefer' | 'allow'",
  'tablePrefix?': 'string',
})

/** Discriminated union on `type` — each variant carries only its own fields. */
export const storeConfigSchema = sqliteStoreConfigSchema
  .or(tursoStoreConfigSchema)
  .or(supabaseStoreConfigSchema)
  .or(postgresStoreConfigSchema)

export const configSchema = type({
  log: { level: logLevel },
  store: storeConfigSchema,
  detection: {
    windowDays: 'number > 0',
    threshold: 'number.integer > 0',
  },
  github: {
    'token?': 'string',
    'repository?': 'string',
  },
  plugin: {
    disabled: 'boolean',
    'runIdOverride?': 'string',
  },
  report: {
    'browser?': 'string',
  },
})

export type Config = typeof configSchema.infer

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

const DEFAULT_WINDOW_DAYS = 7
const DEFAULT_THRESHOLD = 2

function parseBoolean(value: string | undefined): boolean {
  return value === '1' || value === 'true'
}

function parsePositiveNumber(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`${label} must be a positive number, got "${value}"`)
  }
  return parsed
}

function parsePositiveInt(
  value: string | undefined,
  fallback: number,
  label: string,
): number {
  if (value === undefined || value === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0 || !Number.isInteger(parsed)) {
    throw new ConfigError(`${label} must be a positive integer, got "${value}"`)
  }
  return parsed
}

function resolveLogLevelValue(
  value: string | undefined,
): Config['log']['level'] {
  const lowered = value?.toLowerCase()
  if (
    lowered === 'silent' ||
    lowered === 'error' ||
    lowered === 'warn' ||
    lowered === 'debug'
  ) {
    return lowered
  }
  return 'warn'
}

function resolveStoreConfig(env: NodeJS.ProcessEnv): Config['store'] {
  const storeType = env.FLAKY_TESTS_STORE ?? 'sqlite'
  const connectionString = env.FLAKY_TESTS_CONNECTION_STRING
  const authToken = env.FLAKY_TESTS_AUTH_TOKEN

  switch (storeType) {
    case 'sqlite': {
      const dbPath = env.FLAKY_TESTS_DB
      return {
        type: 'sqlite',
        ...(dbPath !== undefined && { path: dbPath }),
      }
    }
    case 'turso': {
      if (!connectionString) {
        throw new ConfigError(
          'FLAKY_TESTS_CONNECTION_STRING is required for store=turso',
        )
      }
      return {
        type: 'turso',
        url: connectionString,
        ...(authToken !== undefined && { authToken }),
      }
    }
    case 'supabase': {
      if (!connectionString || !authToken) {
        throw new ConfigError(
          'FLAKY_TESTS_CONNECTION_STRING and FLAKY_TESTS_AUTH_TOKEN are required for store=supabase',
        )
      }
      return {
        type: 'supabase',
        url: connectionString,
        key: authToken,
      }
    }
    case 'postgres': {
      return {
        type: 'postgres',
        ...(connectionString !== undefined && { connectionString }),
      }
    }
    default:
      throw new ConfigError(
        `FLAKY_TESTS_STORE must be one of sqlite|turso|supabase|postgres, got "${storeType}"`,
      )
  }
}

let cachedConfig: Config | null = null
let cachedEnv: NodeJS.ProcessEnv | null = null

function isConfigObject(value: unknown): value is Config {
  return (
    typeof value === 'object' &&
    value !== null &&
    'log' in value &&
    'store' in value &&
    'detection' in value
  )
}

/**
 * Build the unified config. Three inputs:
 *   - no args → read `process.env` (memoized; repeated calls are free)
 *   - a `NodeJS.ProcessEnv` record → parse that instead (fresh each call)
 *   - a pre-built `Config` → install it as the cached resolution (useful in tests)
 */
export function resolveConfig(source?: NodeJS.ProcessEnv | Config): Config {
  if (isConfigObject(source)) {
    cachedConfig = source
    cachedEnv = process.env
    return source
  }

  const env = source ?? process.env
  if (env === process.env && cachedConfig !== null && cachedEnv === env) {
    return cachedConfig
  }

  const raw = {
    log: { level: resolveLogLevelValue(env.FLAKY_TESTS_LOG) },
    store: resolveStoreConfig(env),
    detection: {
      windowDays: parsePositiveNumber(
        env.FLAKY_TESTS_WINDOW,
        DEFAULT_WINDOW_DAYS,
        'FLAKY_TESTS_WINDOW',
      ),
      threshold: parsePositiveInt(
        env.FLAKY_TESTS_THRESHOLD,
        DEFAULT_THRESHOLD,
        'FLAKY_TESTS_THRESHOLD',
      ),
    },
    github: {
      ...(env.GITHUB_TOKEN !== undefined && { token: env.GITHUB_TOKEN }),
      ...(env.GITHUB_REPOSITORY !== undefined && {
        repository: env.GITHUB_REPOSITORY,
      }),
    },
    plugin: {
      disabled: parseBoolean(env.FLAKY_TESTS_DISABLE),
      ...(env.FLAKY_TESTS_RUN_ID !== undefined && {
        runIdOverride: env.FLAKY_TESTS_RUN_ID,
      }),
    },
    report: {
      ...(env.BROWSER !== undefined && { browser: env.BROWSER }),
    },
  }

  let resolved: Config
  try {
    resolved = parse(configSchema, raw)
  } catch (error) {
    throw new ConfigError(
      error instanceof Error ? error.message : String(error),
    )
  }

  if (env === process.env) {
    cachedConfig = resolved
    cachedEnv = env
  }
  return resolved
}

/** Drop the cached resolution so a subsequent `resolveConfig()` re-reads env. */
export function resetConfigForTesting(): void {
  cachedConfig = null
  cachedEnv = null
}

// ---------------------------------------------------------------------------
// Test credentials
// ---------------------------------------------------------------------------

/** Test-only credentials, kept out of `configSchema` because they're harness params, not runtime config. */
export interface TestCredentials {
  integration: boolean
  tursoUrl: string | undefined
  postgresUrl: string | undefined
  supabaseUrl: string | undefined
  supabaseKey: string | undefined
}

/**
 * Read integration-test credentials from env. Invoked by integration test
 * files instead of having each file touch `process.env` directly, so this
 * module stays the sole env reader.
 */
export function getTestCredentials(): TestCredentials {
  return {
    integration: parseBoolean(process.env.INTEGRATION),
    tursoUrl: process.env.TURSO_TEST_URL,
    postgresUrl: process.env.POSTGRES_TEST_URL,
    supabaseUrl: process.env.SUPABASE_TEST_URL,
    supabaseKey: process.env.SUPABASE_TEST_KEY,
  }
}

// ---------------------------------------------------------------------------
// Subprocess IPC
// ---------------------------------------------------------------------------

/**
 * Publish a generated run id into the current process's env so a spawned
 * child inherits it and can pick it up via `resolveConfig().plugin.runIdOverride`.
 * Centralized here so this module remains the sole `process.env` touchpoint.
 */
export function publishRunIdForSubprocess(runId: string): void {
  process.env.FLAKY_TESTS_RUN_ID = runId
}
