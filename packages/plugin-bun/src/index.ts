import { type Config, definePlugin } from '@flaky-tests/core'
import { createPreload } from './preload'

export type { GitInfo } from './git'
export { captureGitInfo } from './git'
export { createPreload } from './preload'

/** Lazy plugin descriptor — `create(config)` returns the Bun preload wiring helper. */
export const bunPlugin = definePlugin({
  name: 'plugin-bun',
  create(_config: Config) {
    return { createPreload }
  },
})
