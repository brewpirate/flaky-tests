import type { GitInfo } from './types'

/**
 * Runs a command and returns stdout as a string, or null on failure.
 * Each runtime provides its own implementation (Bun.spawnSync, execSync, etc.).
 */
export type RunCommand = (command: string, args: string[]) => string | null

/**
 * Captures the current git SHA and dirty state using the provided command runner.
 * Safe to call outside a git repo — returns `{ sha: null, dirty: null }`.
 *
 * @param runCommand - Runtime-specific function that executes a shell command
 */
export function captureGitInfo(runCommand: RunCommand): GitInfo {
  const sha = runCommand('git', ['rev-parse', 'HEAD'])
  const porcelain = runCommand('git', ['status', '--porcelain'])
  if (sha === null) return { sha: null, dirty: null }
  return {
    sha: sha.trim(),
    dirty: porcelain !== null && porcelain.trim().length > 0,
  }
}
