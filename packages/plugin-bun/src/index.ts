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
