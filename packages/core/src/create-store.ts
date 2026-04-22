/**
 * Build an `IStore` for the adapter selected by `config.store.type`,
 * going through the plugin registry — *no hardcoded adapter list*. A new
 * store adapter is any package that calls
 * `definePlugin({ name: 'store-<type>', create(config) { ... } })` at
 * module import time.
 *
 * Resolution order:
 *   1. If a descriptor named `store-<type>` is already registered (because
 *      the user imported the module themselves, e.g. inside a custom
 *      preload), use it directly.
 *   2. Else try each candidate module specifier in turn and re-check the
 *      registry after each import succeeds. Candidates:
 *        a. `config.store.module` (explicit override / third-party path)
 *        b. `@flaky-tests/store-<type>` (convention for first-party adapters)
 *   3. If nothing matches, throw `MissingStorePackageError` with an
 *      actionable install hint.
 *
 * Dynamic `import()` is deliberate: it makes every store adapter an
 * `optionalDependencies` entry on consumers (cli / plugin-bun) so users
 * only pay the install cost for the backend they actually use.
 */

import type { Config } from './config'
import { MissingStorePackageError } from './errors'
import { listRegisteredPlugins } from './plugin'
import type { IStore } from './types'

interface DynamicImportError extends Error {
  code?: string
}

function isModuleNotFound(error: unknown): boolean {
  const code = (error as DynamicImportError).code
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
    return true
  }
  return (
    error instanceof Error &&
    /Cannot find (module|package)/i.test(error.message)
  )
}

function findDescriptor(storeType: string) {
  return listRegisteredPlugins().find(
    (descriptor) => descriptor.name === `store-${storeType}`,
  )
}

export async function createStoreFromConfig(config: Config): Promise<IStore> {
  const storeType = config.store.type

  let descriptor = findDescriptor(storeType)

  if (descriptor === undefined) {
    const candidateModules = [
      config.store.module,
      `@flaky-tests/store-${storeType}`,
    ].filter((spec): spec is string => typeof spec === 'string' && spec !== '')

    for (const spec of candidateModules) {
      try {
        await import(spec)
      } catch (error) {
        if (isModuleNotFound(error)) continue
        throw error
      }
      descriptor = findDescriptor(storeType)
      if (descriptor !== undefined) break
    }
  }

  if (descriptor === undefined) {
    throw new MissingStorePackageError(
      storeType,
      config.store.module ?? `@flaky-tests/store-${storeType}`,
    )
  }

  return descriptor.create(config) as IStore
}
