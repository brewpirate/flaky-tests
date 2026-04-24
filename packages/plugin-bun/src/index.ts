/**
 * Public entry for `@flaky-tests/plugin-bun`.
 *
 * Exports the lazy {@link bunPlugin} descriptor for the flaky-tests plugin
 * registry, the {@link createPreload} wiring helper for custom preload files,
 * and the {@link captureGitInfo} git-metadata capture used at run start.
 *
 * For the drop-in Bun preload, use the `@flaky-tests/plugin-bun/preload`
 * entrypoint from `bunfig.toml`. For the tracked test runner that reconciles
 * run status on non-zero exits, use `@flaky-tests/plugin-bun/run-tracked`.
 *
 * @module
 */
import {
  type Config,
  definePlugin,
  type FlakyPluginDescriptor,
} from '@flaky-tests/core'
import { createPreload } from './preload'

export type { GitInfo } from './git'
export { captureGitInfo } from './git'
export { createPreload } from './preload'

/** Lazy plugin descriptor — `create(config)` returns the Bun preload wiring helper. */
export const bunPlugin: FlakyPluginDescriptor<{
  createPreload: typeof createPreload
}> = definePlugin({
  name: 'plugin-bun',
  create(_config: Config): { createPreload: typeof createPreload } {
    return { createPreload }
  },
})
