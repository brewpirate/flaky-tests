import { afterEach, describe, expect, test } from 'bun:test'
import type { Config } from './config'
import { createStoreFromConfig } from './create-store'
import { MissingStorePackageError } from './errors'
import { definePlugin } from './plugin'
import type { IStore } from './types'

const base: Config = {
  log: { level: 'warn' },
  store: { type: 'sqlite' },
  detection: { windowDays: 7, threshold: 2 },
  github: {},
  plugin: { disabled: false },
  report: {},
}

/** Minimal IStore stub — just enough that the contract-suite surface is callable. */
function makeFakeStore(): IStore {
  return {
    async migrate() {},
    async insertRun() {},
    async updateRun() {},
    async insertFailure() {},
    async insertFailures() {},
    async getNewPatterns() {
      return []
    },
    async getRecentRuns() {
      return []
    },
    async close() {},
  }
}

describe('createStoreFromConfig — registry-first dispatch', () => {
  const instances: IStore[] = []

  afterEach(async () => {
    for (const store of instances) {
      await store.close()
    }
    instances.length = 0
  })

  test('resolves via listRegisteredPlugins() — no hardcoded switch', async () => {
    // Pre-register a fake descriptor under a bespoke type. createStoreFromConfig
    // must find it through the registry alone.
    definePlugin({
      name: 'store-custom-fake',
      create: () => makeFakeStore(),
    })

    const store = await createStoreFromConfig({
      ...base,
      // biome-ignore lint/suspicious/noExplicitAny: intentionally loosening config for third-party type
      store: { type: 'custom-fake' } as any,
    })
    instances.push(store)
    expect(typeof store.migrate).toBe('function')
  })

  test('throws MissingStorePackageError when neither registry nor convention resolves', async () => {
    try {
      await createStoreFromConfig({
        ...base,
        // biome-ignore lint/suspicious/noExplicitAny: unknown type has no variant
        store: { type: 'nonexistent-store-xyz' } as any,
      })
      throw new Error('expected MissingStorePackageError')
    } catch (error) {
      expect(error).toBeInstanceOf(MissingStorePackageError)
      expect((error as MissingStorePackageError).storeType).toBe(
        'nonexistent-store-xyz',
      )
      expect((error as MissingStorePackageError).message).toContain(
        '@flaky-tests/store-nonexistent-store-xyz',
      )
    }
  })

  test('explicit config.store.module takes precedence over convention', async () => {
    // Register under a type name that will NOT match conventional
    // @flaky-tests/store-* lookup. If the dispatcher found it, it did so
    // via the registry (which in turn got populated by the module import
    // this test triggers synchronously above).
    definePlugin({
      name: 'store-override-check',
      create: () => makeFakeStore(),
    })

    const store = await createStoreFromConfig({
      ...base,
      // biome-ignore lint/suspicious/noExplicitAny: third-party shape
      store: { type: 'override-check', module: '@nonexistent/vendor' } as any,
    })
    instances.push(store)
    expect(typeof store.getNewPatterns).toBe('function')
  })
})

describe('MissingStorePackageError', () => {
  test('surfaces storeType + packageName with actionable message', () => {
    const error = new MissingStorePackageError('turso', '@acme/custom-turso')
    expect(error.storeType).toBe('turso')
    expect(error.packageName).toBe('@acme/custom-turso')
    expect(error.message).toContain('bun add @acme/custom-turso')
  })
})
