import { describe, expect, test } from 'bun:test'
import type {
  FlakyPattern,
  HotFile,
  KindBreakdown,
  RecentRun,
} from '@flaky-tests/core'
import { generateHtml } from './html'

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

describe('generateHtml', () => {
  test('returns a complete HTML document', () => {
    const html = generateHtml([pattern], 7)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('</html>')
  })

  test('includes the pattern test name and file', () => {
    const html = generateHtml([pattern], 7)
    expect(html).toContain('auth &gt; login')
    expect(html).toContain('tests/auth.test.ts')
  })

  test('uses singular "pattern" in title for one result', () => {
    const html = generateHtml([pattern], 7)
    expect(html).toContain('1 pattern')
    expect(html).not.toContain('1 patterns')
  })

  test('uses plural "patterns" for multiple results', () => {
    const html = generateHtml([pattern, { ...pattern, testName: 'other' }], 7)
    expect(html).toContain('2 patterns')
  })

  test('renders empty state when no patterns supplied', () => {
    const html = generateHtml([], 7)
    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('0 patterns')
  })

  test('escapes HTML special characters in test names', () => {
    const risky: FlakyPattern = {
      ...pattern,
      testName: '<script>alert("xss")</script>',
    }
    const html = generateHtml([risky], 7)
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&quot;xss&quot;')
  })

  test('escapes HTML in copy-button data attribute', () => {
    const risky: FlakyPattern = {
      ...pattern,
      testName: 'test"with"quotes',
    }
    const html = generateHtml([risky], 7)
    expect(html).not.toMatch(/data-prompt="[^"]*"with"/)
  })

  test('includes window size in summary header', () => {
    const html = generateHtml([pattern], 14)
    expect(html).toContain('window: 14d')
  })

  test('omits dashboard section when not supplied', () => {
    const html = generateHtml([pattern], 7)
    expect(html).not.toContain('Failure Kind Breakdown')
    expect(html).not.toContain('Hot Files')
    expect(html).not.toContain('Recent Runs')
  })

  test('renders dashboard when supplied', () => {
    const kindBreakdown: KindBreakdown[] = [
      { failureKind: 'timeout', count: 10 },
      { failureKind: 'assertion', count: 3 },
    ]
    const hotFiles: HotFile[] = [
      { testFile: 'tests/flaky.ts', fails: 12, distinctTests: 4 },
    ]
    const recentRuns: RecentRun[] = [
      {
        runId: 'r1',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        durationMs: 1500,
        status: 'pass',
        totalTests: 42,
        passedTests: 42,
        failedTests: 0,
        errorsBetweenTests: 0,
        gitSha: 'abc123def',
        gitDirty: false,
      },
    ]
    const html = generateHtml([pattern], 7, {
      kindBreakdown,
      hotFiles,
      recentRuns,
    })
    expect(html).toContain('Failure Kind Breakdown')
    expect(html).toContain('Hot Files')
    expect(html).toContain('Recent Runs')
    expect(html).toContain('timeout')
    expect(html).toContain('tests/flaky.ts')
    expect(html).toContain('abc123d')
  })

  test('renders "n/a" status for runs without a status', () => {
    const recentRuns: RecentRun[] = [
      {
        runId: 'r2',
        startedAt: new Date().toISOString(),
        endedAt: null,
        durationMs: null,
        status: null,
        totalTests: null,
        passedTests: null,
        failedTests: null,
        errorsBetweenTests: null,
        gitSha: null,
        gitDirty: null,
      },
    ]
    const html = generateHtml([pattern], 7, {
      kindBreakdown: [],
      hotFiles: [],
      recentRuns,
    })
    expect(html).toContain('n/a')
  })
})
