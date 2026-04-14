import type { GitInfo } from '@flaky-tests/core'

function runGit(args: string[]): string | null {
  try {
    const result = Bun.spawnSync({
      cmd: ['git', ...args],
      stdout: 'pipe',
      stderr: 'ignore',
    })
    if (result.exitCode !== 0) return null
    return new TextDecoder().decode(result.stdout)
  } catch {
    return null
  }
}

/**
 * Captures the current git SHA and dirty state by shelling out to `git`.
 * Safe to call outside a git repo — returns `{ sha: null, dirty: null }`.
 */
export function captureGitInfo(): GitInfo {
  const sha = runGit(['rev-parse', 'HEAD'])
  const porcelain = runGit(['status', '--porcelain'])
  if (sha === null) return { sha: null, dirty: null }
  return {
    sha: sha.trim(),
    dirty: porcelain !== null && porcelain.trim().length > 0,
  }
}
