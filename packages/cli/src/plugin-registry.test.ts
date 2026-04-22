/**
 * Registry-completeness guard: importing every plugin and store entrypoint
 * must register its descriptor. Fails loudly if a package drops its
 * `definePlugin(...)` call, so `name` stays a contract rather than rotting
 * into documentation.
 */

import { listRegisteredPlugins } from '@flaky-tests/core'
import { bunPlugin } from '@flaky-tests/plugin-bun'
import { vitestPlugin } from '@flaky-tests/plugin-vitest'
import { postgresStorePlugin } from '@flaky-tests/store-postgres'
import { sqliteStorePlugin } from '@flaky-tests/store-sqlite'
import { supabaseStorePlugin } from '@flaky-tests/store-supabase'
import { tursoStorePlugin } from '@flaky-tests/store-turso'
import { describe, expect, test } from 'bun:test'

const EXPECTED_NAMES = [
  'plugin-bun',
  'plugin-vitest',
  'store-sqlite',
  'store-turso',
  'store-supabase',
  'store-postgres',
]

describe('plugin registry', () => {
  test('every plugin and store package registers on import', () => {
    void bunPlugin
    void vitestPlugin
    void sqliteStorePlugin
    void tursoStorePlugin
    void supabaseStorePlugin
    void postgresStorePlugin

    const registered = listRegisteredPlugins().map((plugin) => plugin.name)
    for (const name of EXPECTED_NAMES) {
      expect(registered).toContain(name)
    }
  })
})
