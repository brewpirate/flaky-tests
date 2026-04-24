/**
 * Core exports for the flaky-tests ecosystem.
 *
 * Storage-agnostic types (`IStore`, `Config`, `FailureKind`), config
 * resolution, failure-pattern detection, retry/abort utilities, the
 * plugin-registry for store adapters, and the shared HTML report
 * generator. Consumed by `@flaky-tests/plugin-bun`,
 * `@flaky-tests/plugin-vitest`, and every `@flaky-tests/store-*` adapter.
 *
 * New store backends integrate here by calling `definePlugin()` with a
 * `name: 'store-<type>'` — no change to core is required.
 *
 * @module
 */
export {
  isRetryableError,
  type RetryOptions,
  raceAbort,
  retryOptionsSchema,
  withRetry,
} from './async'
export {
  type Config,
  configSchema,
  DASHBOARD_WINDOW_DAYS,
  DEFAULT_THRESHOLD,
  DEFAULT_WINDOW_DAYS,
  getTestCredentials,
  HOT_FILE_LIMIT,
  MAX_CLI_ERROR_MESSAGE_LENGTH,
  MAX_FAILED_TESTS_PER_RUN,
  MAX_PROMPT_STACK_LINES,
  MS_PER_DAY,
  publishRunIdForSubprocess,
  RECENT_RUNS_LIMIT,
  resetConfigForTesting,
  resolveConfig,
  storeConfigSchema,
  type TestCredentials,
} from './config'
export {
  ConfigError,
  createLogger,
  type Logger,
  type LogLevel,
  MissingStorePackageError,
  resolveLogLevel,
  StoreError,
} from './errors'
export {
  type BuildInsertFailureInputOpts,
  type BuildInsertRunInputOpts,
  type BuildUpdateRunInputOpts,
  buildInsertFailureInput,
  buildInsertRunInput,
  buildUpdateRunInput,
  captureGitInfo,
  categorizeError,
  DescribeStack,
  extractMessage,
  extractStack,
  type RunCommand,
} from './observe'
export { escapeHtml, generatePrompt } from './report'
export {
  failureKindSchema,
  flakyPatternSchema,
  getNewPatternsOptionsSchema,
  gitInfoSchema,
  insertFailureInputSchema,
  insertRunInputSchema,
  parse,
  parseArray,
  runStatusSchema,
  updateRunInputSchema,
  ValidationError,
  validateTablePrefix,
} from './schema'
export {
  buildListFailuresQuery,
  buildNewPatternsQuery,
  buildRecentRunsQuery,
  CREATE_SCHEMA_VERSION_TABLE,
  createStoreFromConfig,
  definePlugin,
  detectBaselineVersion,
  type FlakyPluginDescriptor,
  INSERT_FAILURE_SQL,
  INSERT_RUN_SQL,
  INSERT_SCHEMA_VERSION_SQL,
  listRegisteredPlugins,
  makeStoreWrapper,
  mapRowToPattern,
  type ParameterizedQuery,
  type PatternRow,
  pendingMigrations,
  pragmaTableInfoSql,
  resetPluginRegistryForTesting,
  SCHEMA_VERSION_TABLE,
  type SchemaInspector,
  SELECT_APPLIED_MIGRATIONS_SQL,
  SELECT_CURRENT_VERSION_SQL,
  SELECT_RUN_STATUS_SQL,
  SELECT_USER_TABLES_SQL,
  SQLITE_MIGRATIONS,
  type SqliteMigration,
  type StoreCallWrapper,
  type StoreModuleImporter,
  stripTimestampPrefix,
  UPDATE_RUN_RECONCILE_SQL,
  UPDATE_RUN_SQL,
} from './store'
export type {
  FailureKind,
  FailureRow,
  FlakyPattern,
  GetNewPatternsOptions,
  GetRecentRunsOptions,
  GitInfo,
  InsertFailureInput,
  InsertRunInput,
  IStore,
  ListFailuresOptions,
  RecentRun,
  RunStatus,
  UpdateRunInput,
} from './types'
