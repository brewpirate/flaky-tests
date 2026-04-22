/**
 * Plugin contract shared by stores and test-runner plugins.
 *
 * A plugin descriptor is a lazy factory: `create(config)` constructs the
 * real instance on demand. Importing a plugin module registers its
 * descriptor without performing any I/O — DB handles and Bun preload
 * wiring only happen when `create()` is called.
 */

import type { Type } from 'arktype'
import type { Config } from './config'

export interface FlakyPluginDescriptor<Instance = unknown> {
  readonly name: string
  readonly configSchema?: Type
  create(config: Config): Instance
}

const registry = new Map<string, FlakyPluginDescriptor>()

/**
 * Register a plugin descriptor. Throws if a plugin with the same name is
 * already registered — silent overwrites would make the registry a
 * last-import-wins lottery.
 */
export function definePlugin<Instance>(
  descriptor: FlakyPluginDescriptor<Instance>,
): FlakyPluginDescriptor<Instance> {
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
  return Array.from(registry.values())
}

/** Drop every registration — test-only escape hatch. */
export function resetPluginRegistryForTesting(): void {
  registry.clear()
}
