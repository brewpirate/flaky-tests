import { z } from 'zod'
import { ConfigError } from './errors'

/**
 * Zod schema accepting the four supported backend names. Kept as a discrete
 * export so CLI callers can validate external input (env var, config file)
 * against the same source of truth that {@link parseCliConfig} uses.
 */
export const StoreTypeSchema = z.enum([
  'sqlite',
  'turso',
  'supabase',
  'postgres',
])

/** Narrowed union of valid {@link StoreTypeSchema} values. */
export type StoreType = z.infer<typeof StoreTypeSchema>

const OptionalString = z.string().or(z.undefined())

/**
 * Schema for the fully-validated CLI configuration. The runtime source of
 * truth — {@link CliConfig} is inferred from this, and {@link parseCliConfig}
 * parses its output against it so the declared shape can't drift from the
 * runtime guarantee.
 */
export const CliConfigSchema = z.object({
  windowDays: z.number().int().positive(),
  threshold: z.number().int().positive(),
  showPrompts: z.boolean(),
  doCopy: z.boolean(),
  doCreateIssue: z.boolean(),
  doHtml: z.boolean(),
  htmlOut: OptionalString,
  storeType: StoreTypeSchema,
  connectionString: OptionalString,
  authToken: OptionalString,
  sqliteDbPath: OptionalString,
  githubToken: OptionalString,
})

/** Fully-validated CLI configuration derived from argv + env. */
export type CliConfig = z.infer<typeof CliConfigSchema>

function hasFlag(argv: readonly string[], name: string): boolean {
  return argv.includes(`--${name}`)
}

function optionValue(
  argv: readonly string[],
  name: string,
): string | undefined {
  const idx = argv.indexOf(`--${name}`)
  if (idx === -1) {
    return undefined
  }
  const value = argv[idx + 1]
  if (value === undefined || value.startsWith('--')) {
    return undefined
  }
  return value
}

const PositiveInt = z.coerce
  .number()
  .int('must be an integer')
  .positive('must be greater than zero')

function parseIntOption(
  raw: string | undefined,
  fieldName: string,
  fallback: number,
): number {
  if (raw === undefined || raw === '') {
    return fallback
  }
  const result = PositiveInt.safeParse(raw)
  if (!result.success) {
    const msg = result.error.issues[0]?.message ?? 'invalid number'
    throw new ConfigError(`--${fieldName}: ${msg} (got ${JSON.stringify(raw)})`)
  }
  return result.data
}

/**
 * Parse CLI configuration from argv + environment into a validated
 * {@link CliConfig}. CLI flags take precedence over env vars; defaults
 * apply only when both are absent (windowDays=7, threshold=2, store=sqlite).
 *
 * The assembled object is validated against {@link CliConfigSchema} so any
 * drift between the declared shape and the runtime guarantee is caught here.
 *
 * Parameters are optional so callers (and tests) can inject fixtures
 * without mutating `process.argv` / `process.env`.
 *
 * @param argv - Argument vector to parse; defaults to `process.argv`
 * @param env - Environment map to read fallbacks from; defaults to `process.env`
 * @throws {@link ConfigError} when `--window`/`--threshold` are non-integer or
 * non-positive, or when `FLAKY_TESTS_STORE` is not one of the four known backends
 */
export function parseCliConfig(
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env,
): CliConfig {
  const windowDays = parseIntOption(
    optionValue(argv, 'window') ?? env.FLAKY_TESTS_WINDOW,
    'window',
    7,
  )
  const threshold = parseIntOption(
    optionValue(argv, 'threshold') ?? env.FLAKY_TESTS_THRESHOLD,
    'threshold',
    2,
  )

  const rawStore = env.FLAKY_TESTS_STORE ?? 'sqlite'
  const storeParsed = StoreTypeSchema.safeParse(rawStore)
  if (!storeParsed.success) {
    throw new ConfigError(
      `FLAKY_TESTS_STORE: must be one of sqlite|turso|supabase|postgres (got ${JSON.stringify(rawStore)})`,
    )
  }

  return CliConfigSchema.parse({
    windowDays,
    threshold,
    showPrompts: hasFlag(argv, 'prompt') || hasFlag(argv, 'copy'),
    doCopy: hasFlag(argv, 'copy'),
    doCreateIssue: hasFlag(argv, 'create-issue'),
    doHtml: hasFlag(argv, 'html'),
    htmlOut: optionValue(argv, 'out'),
    storeType: storeParsed.data,
    connectionString: env.FLAKY_TESTS_CONNECTION_STRING,
    authToken: env.FLAKY_TESTS_AUTH_TOKEN,
    sqliteDbPath: env.FLAKY_TESTS_DB,
    githubToken: env.GITHUB_TOKEN,
  })
}
