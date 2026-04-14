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
 */

// biome-ignore-all lint/suspicious/noConsole: preload is dev tooling

import { SqliteStore } from '@flaky-tests/store-sqlite'
import { createPreload } from './preload'

if (process.env.FLAKY_TESTS_DISABLE !== '1') {
  try {
    const store = new SqliteStore({
      dbPath: process.env.FLAKY_TESTS_DB ?? undefined,
    })
    createPreload(store)
  } catch (error) {
    console.warn('[flaky-tests] Failed to initialise preload:', error)
  }
}
