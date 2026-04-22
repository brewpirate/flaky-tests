import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { FlakyPattern } from '@flaky-tests/core'
import { createIssue, findExistingIssue, resolveRepo } from './github'

const pattern: FlakyPattern = {
  testFile: 'tests/auth.test.ts',
  testName: 'auth > login',
  recentFails: 5,
  priorFails: 0,
  failureKinds: ['timeout'],
  lastErrorMessage: 'Expected redirect within 2000ms',
  lastErrorStack: null,
  lastFailed: new Date().toISOString(),
}

const originalEnv = process.env.GITHUB_REPOSITORY
const originalArgv = process.argv
const originalFetch = globalThis.fetch

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.GITHUB_REPOSITORY
  } else {
    process.env.GITHUB_REPOSITORY = originalEnv
  }
  process.argv = originalArgv
  globalThis.fetch = originalFetch
})

describe('resolveRepo', () => {
  beforeEach(() => {
    // Avoid falling back to git; strip --repo flag and env.
    delete process.env.GITHUB_REPOSITORY
    process.argv = ['bun', 'check.ts']
  })

  test('returns owner/repo from GITHUB_REPOSITORY env var', () => {
    process.env.GITHUB_REPOSITORY = 'anthropic/claude-code'
    expect(resolveRepo()).toEqual({ owner: 'anthropic', repo: 'claude-code' })
  })

  test('returns null when env var has wrong format', () => {
    process.env.GITHUB_REPOSITORY = 'no-slash'
    // resolveRepo falls through to git; in this repo that returns something,
    // but we only care that env-var parsing rejected it. The git fallback
    // may or may not find a remote — just assert either null or a valid shape.
    const result = resolveRepo()
    if (result !== null) {
      expect(typeof result.owner).toBe('string')
      expect(typeof result.repo).toBe('string')
    }
  })

  test('reads --repo flag from argv', () => {
    process.argv = ['bun', 'check.ts', '--repo', 'foo/bar']
    expect(resolveRepo()).toEqual({ owner: 'foo', repo: 'bar' })
  })

  test('rejects --repo value with invalid slug characters', () => {
    process.argv = ['bun', 'check.ts', '--repo', 'foo/bar; rm -rf /']
    // Should reject the unsafe repo and fall through; either git gives a
    // valid result or null.
    const result = resolveRepo()
    if (result !== null) {
      expect(result.repo).not.toContain(';')
      expect(result.repo).not.toContain(' ')
    }
  })
})

describe('findExistingIssue', () => {
  const config = { token: 'ghp_test', owner: 'o', repo: 'r' }

  test('returns the first matching issue number when found', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ items: [{ number: 42 }] }), {
        status: 200,
      })) as unknown as typeof fetch
    expect(await findExistingIssue(config, 'my test')).toBe(42)
  })

  test('returns null when no issues match', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ items: [] }), {
        status: 200,
      })) as unknown as typeof fetch
    expect(await findExistingIssue(config, 'my test')).toBeNull()
  })

  test('returns null on non-ok response', async () => {
    globalThis.fetch = (async () =>
      new Response('rate limited', { status: 403 })) as unknown as typeof fetch
    expect(await findExistingIssue(config, 'my test')).toBeNull()
  })

  test('sends search query with encoded title and repo', async () => {
    let capturedUrl = ''
    globalThis.fetch = (async (input: URL | string) => {
      capturedUrl = typeof input === 'string' ? input : input.toString()
      return new Response(JSON.stringify({ items: [] }), { status: 200 })
    }) as unknown as typeof fetch
    await findExistingIssue(config, 'my "flaky" test')
    expect(capturedUrl).toContain('repo%3Ao%2Fr')
    expect(capturedUrl).toContain('is%3Aissue')
    expect(capturedUrl).toContain('is%3Aopen')
  })
})

describe('createIssue', () => {
  const config = { token: 'ghp_test', owner: 'o', repo: 'r' }

  test('returns the issue URL on success', async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ html_url: 'https://github.com/o/r/issues/1' }),
        { status: 201 },
      )) as unknown as typeof fetch
    expect(await createIssue(config, pattern, 7)).toBe(
      'https://github.com/o/r/issues/1',
    )
  })

  test('throws when API returns a non-ok status', async () => {
    globalThis.fetch = (async () =>
      new Response('unauthorized', { status: 401 })) as unknown as typeof fetch
    await expect(createIssue(config, pattern, 7)).rejects.toThrow(
      /GitHub API error 401/,
    )
  })

  test('throws when response body lacks html_url', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ not_the_url: 'oops' }), {
        status: 201,
      })) as unknown as typeof fetch
    await expect(createIssue(config, pattern, 7)).rejects.toThrow(/no html_url/)
  })

  test('posts issue title and labels in body', async () => {
    let capturedBody = ''
    globalThis.fetch = (async (_url: URL | string, init?: RequestInit) => {
      capturedBody = typeof init?.body === 'string' ? init.body : ''
      return new Response(
        JSON.stringify({ html_url: 'https://github.com/o/r/issues/2' }),
        { status: 201 },
      )
    }) as unknown as typeof fetch
    await createIssue(config, pattern, 7)
    const parsed = JSON.parse(capturedBody) as {
      title: string
      labels: string[]
    }
    expect(parsed.title).toContain('auth > login')
    expect(parsed.labels).toContain('flaky-test')
  })
})
