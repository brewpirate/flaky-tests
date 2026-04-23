import { describe, expect, test } from 'bun:test'
import type { FlakyPattern } from '../../index'
import { renderPatterns } from './render-patterns'

const pattern: FlakyPattern = {
  testFile: 'packages/auth/tests/login.test.ts',
  testName: 'auth > login redirects after success',
  recentFails: 6,
  priorFails: 0,
  failureKinds: ['timeout'],
  lastErrorMessage: 'Expected redirect within 2000ms',
  lastErrorStack: null,
  lastFailed: '2026-04-22T00:00:00.000Z',
}

describe('renderPatterns', () => {
  test('emits the empty-state marker when no patterns supplied', () => {
    expect(renderPatterns([], 7)).toBe(
      '<div class="empty">No flaky patterns detected in this window.</div>',
    )
  })

  test('escapes untrusted test names and paths', () => {
    const risky: FlakyPattern = {
      ...pattern,
      testName: '<script>alert("xss")</script>',
      testFile: 'path/<evil>.ts',
    }
    const html = renderPatterns([risky], 7)
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&lt;evil&gt;.ts')
  })

  test('applies the correct severity class per bucket', () => {
    const critical = { ...pattern, recentFails: 12 }
    const high = { ...pattern, recentFails: 7 }
    const medium = { ...pattern, recentFails: 3 }
    const low = { ...pattern, recentFails: 1 }
    expect(renderPatterns([critical], 7)).toContain('sev-critical')
    expect(renderPatterns([high], 7)).toContain('sev-high')
    expect(renderPatterns([medium], 7)).toContain('sev-medium')
    expect(renderPatterns([low], 7)).toContain('sev-low')
  })

  test('matches snapshot for a representative pattern', () => {
    expect(renderPatterns([pattern], 7)).toMatchSnapshot()
  })
})
