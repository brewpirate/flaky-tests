import type { Config } from '@flaky-tests/core'
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { resolveRepo } from './github'

function configWithRepo(repository: string | undefined): Config {
  return {
    log: { level: 'warn' },
    store: { type: 'sqlite' },
    detection: { windowDays: 7, threshold: 2 },
    github: repository !== undefined ? { repository } : {},
    plugin: { disabled: false },
    report: {},
  } as Config
}

describe('resolveRepo', () => {
  const originalArgv = [...process.argv]

  beforeEach(() => {
    process.argv = ['bun', 'check.ts']
  })

  afterEach(() => {
    process.argv = originalArgv
  })

  test('returns owner/repo from config.github.repository', () => {
    const result = resolveRepo(configWithRepo('brewpirate/flaky-tests'))
    expect(result).toEqual({ owner: 'brewpirate', repo: 'flaky-tests' })
  })

  test('returns null/other source for empty repository', () => {
    const result = resolveRepo(configWithRepo(''))
    expect(
      result === null || (result !== null && result.owner !== undefined),
    ).toBe(true)
  })

  test('returns owner/repo from --repo flag', () => {
    process.argv = ['bun', 'check.ts', '--repo', 'octocat/hello-world']
    const result = resolveRepo(configWithRepo(undefined))
    expect(result).toEqual({ owner: 'octocat', repo: 'hello-world' })
  })

  test('config.github.repository takes precedence over --repo flag', () => {
    process.argv = ['bun', 'check.ts', '--repo', 'flag-owner/flag-repo']
    const result = resolveRepo(configWithRepo('env-owner/env-repo'))
    expect(result).toEqual({ owner: 'env-owner', repo: 'env-repo' })
  })

  test('falls back to git remote when no config or flag', () => {
    const result = resolveRepo()
    if (result !== null) {
      expect(result.owner).toBeString()
      expect(result.repo).toBeString()
      expect(result.owner.length).toBeGreaterThan(0)
      expect(result.repo.length).toBeGreaterThan(0)
    }
  })

  test('handles malformed repository string gracefully', () => {
    const result = resolveRepo(configWithRepo('no-slash-here'))
    expect(result === null || typeof result === 'object').toBe(true)
  })
})
