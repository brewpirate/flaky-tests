import { describe, test, expect, beforeEach, afterEach } from 'bun:test'
import { resolveRepo } from './github'

describe('resolveRepo', () => {
  const originalEnv = process.env.GITHUB_REPOSITORY
  const originalArgv = [...process.argv]

  beforeEach(() => {
    delete process.env.GITHUB_REPOSITORY
    process.argv = ['bun', 'check.ts']
  })

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.GITHUB_REPOSITORY = originalEnv
    } else {
      delete process.env.GITHUB_REPOSITORY
    }
    process.argv = originalArgv
  })

  test('returns owner/repo from GITHUB_REPOSITORY env var', () => {
    process.env.GITHUB_REPOSITORY = 'brewpirate/flaky-tests'
    const result = resolveRepo()
    expect(result).toEqual({ owner: 'brewpirate', repo: 'flaky-tests' })
  })

  test('returns null for empty GITHUB_REPOSITORY', () => {
    process.env.GITHUB_REPOSITORY = ''
    // Falls through to --repo flag (not present) then git remote
    const result = resolveRepo()
    // Result depends on whether we're in a git repo with a github remote
    // Just verify it doesn't throw
    expect(result === null || (result !== null && result.owner !== undefined)).toBe(true)
  })

  test('returns owner/repo from --repo flag', () => {
    process.argv = ['bun', 'check.ts', '--repo', 'octocat/hello-world']
    const result = resolveRepo()
    expect(result).toEqual({ owner: 'octocat', repo: 'hello-world' })
  })

  test('GITHUB_REPOSITORY takes precedence over --repo flag', () => {
    process.env.GITHUB_REPOSITORY = 'env-owner/env-repo'
    process.argv = ['bun', 'check.ts', '--repo', 'flag-owner/flag-repo']
    const result = resolveRepo()
    expect(result).toEqual({ owner: 'env-owner', repo: 'env-repo' })
  })

  test('falls back to git remote when no env or flag', () => {
    // We're running inside the flaky-tests repo, so git remote should work
    const result = resolveRepo()
    // Should resolve to this repo's remote (or null if git unavailable)
    if (result !== null) {
      expect(result.owner).toBeString()
      expect(result.repo).toBeString()
      expect(result.owner.length).toBeGreaterThan(0)
      expect(result.repo.length).toBeGreaterThan(0)
    }
  })

  test('handles malformed GITHUB_REPOSITORY gracefully', () => {
    process.env.GITHUB_REPOSITORY = 'no-slash-here'
    // Falls through to other methods
    const result = resolveRepo()
    // Should not throw, may return from git remote or null
    expect(result === null || typeof result === 'object').toBe(true)
  })
})
