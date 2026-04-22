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
 *   2. Else call the `importer` for each candidate specifier and re-check
 *      the registry after each success. Candidates:
 *        a. `config.store.module` (explicit override / third-party path)
 *        b. `@flaky-tests/store-<type>` (convention for first-party adapters)
 *   3. If nothing matches, throw `MissingStorePackageError`.
 *
 * ## Why `importer` is an injected callback
 *
 * `await import(spec)` resolves specifiers relative to the **calling
 * module's** filesystem location. If this file does the import, Node
 * walks up from `packages/core/` — which misses store packages that
 * were linked into a consumer's own `node_modules` (workspace symlinks
 * don't hoist the way published-package installs do).
 *
 * The consumer (CLI, plugin-bun) owns its own dep graph, so the consumer
 * passes a closure that captures *its* module context. The default
 * `(spec) => import(spec)` is fine for tests and for tree-shaken
 * published builds where core and the stores end up in the same
 * `node_modules`, but every real host should pass its own:
 *
 * ```ts
 * // In a CLI or plugin entry file:
 * await createStoreFromConfig(config, (spec) => import(spec))
 * ```
 */

import type { Config } from './config'
import { MissingStorePackageError } from './errors'
import { listRegisteredPlugins } from './plugin'
import type { IStore } from './types'

export type StoreModuleImporter = (spec: string) => Promise<unknown>

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

const defaultImporter: StoreModuleImporter = (spec) => import(spec)

export async function createStoreFromConfig(
  config: Config,
  importer: StoreModuleImporter = defaultImporter,
): Promise<IStore> {
  const storeType = config.store.type

  let descriptor = findDescriptor(storeType)

  if (descriptor === undefined) {
    const candidateModules = [
      config.store.module,
      `@flaky-tests/store-${storeType}`,
    ].filter((spec): spec is string => typeof spec === 'string' && spec !== '')

    for (const spec of candidateModules) {
      try {
        await importer(spec)
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
