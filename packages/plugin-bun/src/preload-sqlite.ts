/**
 * Default Bun preload — uses the SQLite store.
 *
 * Configure in bunfig.toml:
 *
 *   [test]
 *   preload = ["@flaky-tests/plugin-bun/preload"]
 *
 * Configuration flows through `resolveConfig()` — see core/src/config.ts.
 */

// biome-ignore-all lint/suspicious/noConsole: preload is dev tooling

import { resolveConfig } from '@flaky-tests/core'
import { sqliteStorePlugin } from '@flaky-tests/store-sqlite'
import { createPreload } from './preload'

const config = resolveConfig()
if (!config.plugin.disabled) {
  try {
    const store = sqliteStorePlugin.create(config)
    createPreload(store)
  } catch (error) {
    console.warn('[flaky-tests] Failed to initialise preload:', error)
  }
}
