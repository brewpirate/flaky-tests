import {
  captureGitInfo as captureGitInfoCore,
  type GitInfo,
  type RunCommand,
} from '@flaky-tests/core'

export type { GitInfo } from '@flaky-tests/core'

/** Bun-native command runner injected into the core git capture helper so this package has no Node child_process dependency. */
const runCommand: RunCommand = (command, args) => {
  try {
    const result = Bun.spawnSync({
      cmd: [command, ...args],
      stdout: 'pipe',
      stderr: 'ignore',
    })
    if (result.exitCode !== 0) {
      return null
    }
    return new TextDecoder().decode(result.stdout)
  } catch {
    return null
  }
}

/**
 * Captures the current git SHA and dirty state using Bun.spawnSync.
 * Safe to call outside a git repo — returns `{ sha: null, dirty: null }`.
 */
export function captureGitInfo(): GitInfo {
  return captureGitInfoCore(runCommand)
}
