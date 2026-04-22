/**
 * Plugin contract shared by stores and test-runner plugins.
 *
 * A plugin descriptor is a lazy factory: `create(config)` constructs the
 * real instance on demand. Importing a plugin module registers its
 * descriptor without performing any I/O — DB handles and Bun preload
 * wiring only happen when `create()` is called.
 *
 * The backing registry is stored on `globalThis` via `Symbol.for` so every
 * instance of this module — including the duplicate instances you get when
 * a linked monorepo package drags its own copy of `@flaky-tests/core` into
 * a consumer's `node_modules` — shares the same registry. Without this, a
 * linked `@flaky-tests/store-turso` registers against its *own* core
 * instance and the CLI (running against the consumer's core instance) sees
 * an empty registry.
 */

import type { Type } from 'arktype'
import type { Config } from './config'

export interface FlakyPluginDescriptor<Instance = unknown> {
  readonly name: string
  readonly configSchema?: Type
  create(config: Config): Instance
}

type Registry = Map<string, FlakyPluginDescriptor>

const REGISTRY_KEY = Symbol.for('flaky-tests.plugin-registry')

function getRegistry(): Registry {
  const globals = globalThis as unknown as Record<symbol, Registry | undefined>
  const existing = globals[REGISTRY_KEY]
  if (existing !== undefined) return existing
  const fresh: Registry = new Map()
  globals[REGISTRY_KEY] = fresh
  return fresh
}

/**
 * Register a plugin descriptor. Throws if a plugin with the same name is
 * already registered — silent overwrites would make the registry a
 * last-import-wins lottery.
 */
export function definePlugin<Instance>(
  descriptor: FlakyPluginDescriptor<Instance>,
): FlakyPluginDescriptor<Instance> {
  const registry = getRegistry()
  const existing = registry.get(descriptor.name)
  if (existing !== undefined && existing !== descriptor) {
    throw new Error(
      `flaky-tests: plugin "${descriptor.name}" is already registered`,
    )
  }
  registry.set(descriptor.name, descriptor as FlakyPluginDescriptor)
  return descriptor
}

/** Read-only snapshot of every registered plugin descriptor. */
export function listRegisteredPlugins(): ReadonlyArray<FlakyPluginDescriptor> {
  return Array.from(getRegistry().values())
}

/** Drop every registration — test-only escape hatch. */
export function resetPluginRegistryForTesting(): void {
  getRegistry().clear()
}
