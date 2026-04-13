export interface GitInfo {
  sha: string | null
  dirty: boolean | null
}

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

export function captureGitInfo(): GitInfo {
  const sha = runGit(['rev-parse', 'HEAD'])
  const porcelain = runGit(['status', '--porcelain'])
  if (sha === null) return { sha: null, dirty: null }
  return {
    sha: sha.trim(),
    dirty: porcelain !== null && porcelain.trim().length > 0,
  }
}
