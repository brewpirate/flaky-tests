/**
 * Default Bun preload — resolves the configured store via
 * {@link createStoreFromConfig} so this entry is NOT tied to any
 * particular adapter. Configure with:
 *
 *   [test]
 *   preload = ["@flaky-tests/plugin-bun/preload"]
 *
 * Set `FLAKY_TESTS_STORE=sqlite|turso|postgres|supabase` (plus the
 * matching credentials env vars) to route failures to the backend of
 * your choice. Install only the store package you actually use —
 * every adapter is an `optionalDependency`.
 *
 * @module
 */

// biome-ignore-all lint/suspicious/noConsole: preload is dev tooling

import {
  createLogger,
  createStoreFromConfig,
  MissingStorePackageError,
  resolveConfig,
} from '@flaky-tests/core'
import { createPreload } from './preload'

const log = createLogger('plugin-bun:preload')
const config = resolveConfig()
if (!config.plugin.disabled) {
  try {
    // The `import(spec)` closure lives in this file so specifiers resolve
    // against plugin-bun's own `node_modules` — core can't see the
    // consumer's linked store packages from its own location.
    const store = await createStoreFromConfig(config, (spec) => import(spec))
    // Remote stores need their schema created before the first write —
    // without this, fresh Turso/Postgres DBs fail every insertRun /
    // insertFailure with "no such table" and the safeVoid wrapper
    // silently swallows the error, leaving the DB empty.
    // migrate() is idempotent on every adapter so running it on each
    // test process startup is safe (CREATE TABLE IF NOT EXISTS).
    try {
      await store.migrate()
    } catch (migrateError) {
      log.warn(
        'migrate failed — writes will likely drop until the schema is in place:',
        migrateError instanceof Error ? migrateError.message : migrateError,
      )
    }
    createPreload(store)
  } catch (error) {
    // Fail fast with actionable text. Bun treats a preload throw as a
    // preload failure and surfaces the message to the user — that's the
    // behaviour we want for a missing adapter install (option A from
    // issue #42's follow-up): never silently drop test data.
    if (error instanceof MissingStorePackageError) {
      console.error(`[flaky-tests] ${error.message}`)
    } else {
      console.error(
        '[flaky-tests] Failed to initialise preload:',
        error instanceof Error ? error.message : error,
      )
    }
    throw error
  }
}
