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
export { stripTimestampPrefix } from './store-utils'
