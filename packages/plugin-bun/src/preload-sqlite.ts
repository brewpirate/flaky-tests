/**
 * Default Bun preload — uses the SQLite store.
 *
 * Configure in bunfig.toml:
 *
 *   [test]
 *   preload = ["@flaky-tests/plugin-bun/preload"]
 *
 * Environment variables:
 *   FLAKY_TESTS_DISABLE=1   — skip all telemetry
 *   FLAKY_TESTS_DB=<path>   — override DB path
 *   FLAKY_TESTS_RUN_ID=<id> — set by run-tracked for reconciliation
 *   FLAKY_TESTS_DEBUG=1     — emit diagnostic warnings to stderr
 */

import { debugWarn } from '@flaky-tests/core'
import { SqliteStore } from '@flaky-tests/store-sqlite'
import { createPreload } from './preload'

if (process.env.FLAKY_TESTS_DISABLE !== '1') {
  try {
    const dbPath = process.env.FLAKY_TESTS_DB
    const store = new SqliteStore(dbPath !== undefined ? { dbPath } : {})
    createPreload(store)
  } catch (error) {
    debugWarn('Failed to initialise preload', error)
  }
}
