/**
 * Unified runtime configuration for flaky-tests.
 *
 * This module is the ONLY place in the codebase that reads `process.env`.
 * Every other caller goes through `resolveConfig()`. One narrow exception
 * lives in `plugin-bun/src/run-tracked.ts`, which *writes* FLAKY_TESTS_RUN_ID
 * as IPC to its `bun test` child — that is not a config read.
 */

import { readFileSync } from 'node:fs'
import { basename, dirname, resolve } from 'node:path'
import { type } from 'arktype'
import { ConfigError } from './errors'
import { parse } from './validate-schemas'

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const logLevel = type("'silent' | 'error' | 'warn' | 'debug'")

// Every variant accepts an optional `module` override so users can point
// the dispatcher at a fork or alternative package path for the same type.
const sqliteStoreConfigSchema = type({
  type: "'sqlite'",
  'path?': 'string',
  'module?': 'string',
})

/** Retry config shared by all network-backed stores; ignored by sqlite. */
const retryConfigSchema = type({
  'attempts?': 'number > 0',
  'baseMs?': 'number > 0',
})

const tursoStoreConfigSchema = type({
  type: "'turso'",
  url: type.string.atLeastLength(1),
  'authToken?': 'string',
  'module?': 'string',
  'retry?': retryConfigSchema,
})

const supabaseStoreConfigSchema = type({
  type: "'supabase'",
  url: type.string.atLeastLength(1),
  key: type.string.atLeastLength(1),
  'tablePrefix?': 'string',
  'module?': 'string',
  'retry?': retryConfigSchema,
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
  'module?': 'string',
  'retry?': retryConfigSchema,
})

/** Discriminated union on `type` — each variant carries only its own fields. */
export const storeConfigSchema = sqliteStoreConfigSchema
  .or(tursoStoreConfigSchema)
  .or(supabaseStoreConfigSchema)
  .or(postgresStoreConfigSchema)

export const configSchema = type({
  /**
   * Project name — scopes every write and read so multiple projects can
   * share one store without their runs commingling. Resolved from
   * FLAKY_TESTS_PROJECT if set; otherwise the nearest package.json's
   * `name` (cwd walk-up); otherwise the cwd basename. Pass `null` to
   * explicitly opt out (rows stored with NULL project).
   */
  'project?': 'string | null',
  log: {
    level: logLevel,
    /** Optional file path — every log line is appended here IN ADDITION to the console sink. Resolved relative to the process cwd. */
    'file?': 'string',
  },
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

/** Walk up from `start` reading each `package.json`; return the first
 *  one's `name` field, or `null` if none found or parse fails. */
function readNearestPackageName(start: string): string | null {
  let dir = start
  // Loop with a hard ceiling; `dirname('/')` returns '/' so detect that
  // to break out on POSIX; Windows `C:\` → `C:\` same pattern.
  const MAX_PACKAGE_JSON_WALK_UP_DEPTH = 32
  for (let i = 0; i < MAX_PACKAGE_JSON_WALK_UP_DEPTH; i++) {
    try {
      const contents = readFileSync(resolve(dir, 'package.json'), 'utf8')
      const parsed = JSON.parse(contents) as { name?: unknown }
      if (typeof parsed.name === 'string' && parsed.name.length > 0) {
        return parsed.name
      }
    } catch {
      // No package.json here or parse failed — walk up.
    }
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
  return null
}

/** Resolve the project name via env → package.json name → cwd basename. */
function resolveProjectName(env: NodeJS.ProcessEnv): string | null {
  const explicit = env.FLAKY_TESTS_PROJECT
  if (explicit !== undefined) {
    // Empty string is treated as "opt out" — write/read rows with NULL
    // project. Any non-empty value wins.
    return explicit === '' ? null : explicit
  }
  const fromPackage = readNearestPackageName(process.cwd())
  if (fromPackage !== null) return fromPackage
  const cwdName = basename(process.cwd())
  return cwdName.length > 0 ? cwdName : null
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
  const module = env.FLAKY_TESTS_STORE_MODULE

  const withModule = <T>(base: T): T =>
    (module !== undefined ? { ...base, module } : base) as T

  switch (storeType) {
    case 'sqlite': {
      const dbPath = env.FLAKY_TESTS_DB
      return withModule({
        type: 'sqlite',
        ...(dbPath !== undefined && { path: dbPath }),
      })
    }
    case 'turso': {
      if (!connectionString) {
        throw new ConfigError(
          'FLAKY_TESTS_CONNECTION_STRING is required for store=turso',
        )
      }
      return withModule({
        type: 'turso',
        url: connectionString,
        ...(authToken !== undefined && { authToken }),
      })
    }
    case 'supabase': {
      if (!connectionString || !authToken) {
        throw new ConfigError(
          'FLAKY_TESTS_CONNECTION_STRING and FLAKY_TESTS_AUTH_TOKEN are required for store=supabase',
        )
      }
      return withModule({
        type: 'supabase',
        url: connectionString,
        key: authToken,
      })
    }
    case 'postgres': {
      return withModule({
        type: 'postgres',
        ...(connectionString !== undefined && { connectionString }),
      })
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

  const project = resolveProjectName(env)
  const raw = {
    ...(project !== null && { project }),
    log: {
      level: resolveLogLevelValue(env.FLAKY_TESTS_LOG),
      ...(env.FLAKY_TESTS_LOG_FILE !== undefined &&
        env.FLAKY_TESTS_LOG_FILE !== '' && {
          file: env.FLAKY_TESTS_LOG_FILE,
        }),
    },
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
  /** Live-E2E credentials — separate gate from the contract-suite `integration` flag so ops can opt in per-store. */
  tursoLive: boolean
  tursoLiveUrl: string | undefined
  tursoLiveToken: string | undefined
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
    tursoLive: parseBoolean(process.env.FLAKY_TESTS_TURSO_LIVE),
    tursoLiveUrl: process.env.TURSO_LIVE_URL,
    tursoLiveToken: process.env.TURSO_LIVE_TOKEN,
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
