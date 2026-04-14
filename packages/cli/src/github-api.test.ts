import { describe, test, expect, mock, afterEach } from 'bun:test'
import type { FlakyPattern } from '@flaky-tests/core'
import { type } from 'arktype'
import { gitHubConfigSchema, findExistingIssue, createIssue, type GitHubConfig } from './github'

// ---------------------------------------------------------------------------
// gitHubConfigSchema
// ---------------------------------------------------------------------------

describe('gitHubConfigSchema', () => {
  function isError(result: unknown): boolean {
    return result instanceof type.errors
  }

  test('accepts valid config', () => {
    expect(isError(gitHubConfigSchema({ token: 'ghp_abc', owner: 'brewpirate', repo: 'flaky-tests' }))).toBe(false)
  })

  test('rejects empty token', () => {
    expect(isError(gitHubConfigSchema({ token: '', owner: 'x', repo: 'y' }))).toBe(true)
  })

  test('rejects empty owner', () => {
    expect(isError(gitHubConfigSchema({ token: 'tok', owner: '', repo: 'y' }))).toBe(true)
  })

  test('rejects empty repo', () => {
    expect(isError(gitHubConfigSchema({ token: 'tok', owner: 'x', repo: '' }))).toBe(true)
  })

  test('rejects missing token', () => {
    expect(isError(gitHubConfigSchema({ owner: 'x', repo: 'y' }))).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testConfig: GitHubConfig = {
  token: 'ghp_test123',
  owner: 'testowner',
  repo: 'testrepo',
}

function makePattern(overrides: Partial<FlakyPattern> = {}): FlakyPattern {
  return {
    testFile: 'tests/auth.test.ts',
    testName: 'auth > login',
    recentFails: 3,
    priorFails: 0,
    failureKinds: ['assertion'],
    lastErrorMessage: 'Expected true to be false',
    lastErrorStack: null,
    lastFailed: '2024-06-15T10:00:00.000Z',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// findExistingIssue
// ---------------------------------------------------------------------------

describe('findExistingIssue()', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('returns issue number when found', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ items: [{ number: 42 }] }), { status: 200 })),
    )
    const result = await findExistingIssue(testConfig, 'auth > login')
    expect(result).toBe(42)
  })

  test('returns null when no matching issues', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 })),
    )
    const result = await findExistingIssue(testConfig, 'auth > login')
    expect(result).toBeNull()
  })

  test('returns null on non-ok response', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('rate limited', { status: 403 })),
    )
    const result = await findExistingIssue(testConfig, 'auth > login')
    expect(result).toBeNull()
  })

  test('sends correct authorization header', async () => {
    let capturedHeaders: Headers | undefined
    globalThis.fetch = mock((_url: string, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers)
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }))
    })
    await findExistingIssue(testConfig, 'test')
    expect(capturedHeaders?.get('Authorization')).toBe('Bearer ghp_test123')
  })

  test('encodes test name in search query', async () => {
    let capturedUrl = ''
    globalThis.fetch = mock((url: string) => {
      capturedUrl = url
      return Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200 }))
    })
    await findExistingIssue(testConfig, 'auth > login')
    expect(capturedUrl).toContain('flaky-test')
    expect(capturedUrl).toContain('testowner%2Ftestrepo')
  })
})

// ---------------------------------------------------------------------------
// createIssue
// ---------------------------------------------------------------------------

describe('createIssue()', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('returns issue URL on success', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ html_url: 'https://github.com/testowner/testrepo/issues/1' }), { status: 201 })),
    )
    const url = await createIssue(testConfig, makePattern(), 7)
    expect(url).toBe('https://github.com/testowner/testrepo/issues/1')
  })

  test('sends POST to correct endpoint', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    globalThis.fetch = mock((url: string, init?: RequestInit) => {
      capturedUrl = url
      capturedMethod = init?.method ?? ''
      return Promise.resolve(new Response(JSON.stringify({ html_url: 'https://x' }), { status: 201 }))
    })
    await createIssue(testConfig, makePattern(), 7)
    expect(capturedUrl).toBe('https://api.github.com/repos/testowner/testrepo/issues')
    expect(capturedMethod).toBe('POST')
  })

  test('includes flaky-test label', async () => {
    let capturedBody = ''
    globalThis.fetch = mock((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string
      return Promise.resolve(new Response(JSON.stringify({ html_url: 'https://x' }), { status: 201 }))
    })
    await createIssue(testConfig, makePattern(), 7)
    const parsed = JSON.parse(capturedBody)
    expect(parsed.labels).toContain('flaky-test')
  })

  test('includes test name in title', async () => {
    let capturedBody = ''
    globalThis.fetch = mock((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string
      return Promise.resolve(new Response(JSON.stringify({ html_url: 'https://x' }), { status: 201 }))
    })
    await createIssue(testConfig, makePattern(), 7)
    const parsed = JSON.parse(capturedBody)
    expect(parsed.title).toContain('auth > login')
  })

  test('throws on non-ok response', async () => {
    globalThis.fetch = mock(() =>
      Promise.resolve(new Response('Validation Failed', { status: 422 })),
    )
    expect(createIssue(testConfig, makePattern(), 7)).rejects.toThrow('GitHub API error 422')
  })

  test('includes investigation prompt in body', async () => {
    let capturedBody = ''
    globalThis.fetch = mock((_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string
      return Promise.resolve(new Response(JSON.stringify({ html_url: 'https://x' }), { status: 201 }))
    })
    await createIssue(testConfig, makePattern(), 7)
    const parsed = JSON.parse(capturedBody)
    expect(parsed.body).toContain('has become flaky')
    expect(parsed.body).toContain('Investigation prompt')
  })
})
