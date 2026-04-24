export {
  createStoreFromConfig,
  type StoreModuleImporter,
} from './create-store'
export {
  CREATE_SCHEMA_VERSION_TABLE,
  detectBaselineVersion,
  pendingMigrations,
  SCHEMA_VERSION_TABLE,
  type SchemaInspector,
  SQLITE_MIGRATIONS,
  type SqliteMigration,
} from './migrations'
export { mapRowToPattern, type PatternRow } from './pattern-mapper'
export {
  definePlugin,
  type FlakyPluginDescriptor,
  listRegisteredPlugins,
  resetPluginRegistryForTesting,
} from './plugin'
export {
  buildListFailuresQuery,
  buildNewPatternsQuery,
  buildRecentRunsQuery,
  INSERT_FAILURE_SQL,
  INSERT_RUN_SQL,
  INSERT_SCHEMA_VERSION_SQL,
  type ParameterizedQuery,
  pragmaTableInfoSql,
  SELECT_APPLIED_MIGRATIONS_SQL,
  SELECT_CURRENT_VERSION_SQL,
  SELECT_RUN_STATUS_SQL,
  SELECT_USER_TABLES_SQL,
  UPDATE_RUN_RECONCILE_SQL,
  UPDATE_RUN_SQL,
} from './sqlite-queries'
export {
  makeStoreWrapper,
  type StoreCallWrapper,
  stripTimestampPrefix,
} from './store-utils'
