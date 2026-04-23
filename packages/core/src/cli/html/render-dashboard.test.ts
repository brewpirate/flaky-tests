import { describe, expect, test } from 'bun:test'
import type { FlakyPattern } from '../../index'
import {
  type DashboardData,
  renderDashboard,
  renderSummaryStats,
  renderToc,
} from './render-dashboard'

const pattern: FlakyPattern = {
  testFile: 'packages/api/tests/jobs.test.ts',
  testName: 'jobs > enqueue returns an id',
  recentFails: 4,
  priorFails: 0,
  failureKinds: ['assertion'],
  lastErrorMessage: 'expected a string',
  lastErrorStack: null,
  lastFailed: '2026-04-22T00:00:00.000Z',
}

const dashboard: DashboardData = {
  kindBreakdown: [
    { failureKind: 'timeout', count: 10 },
    { failureKind: 'assertion', count: 3 },
  ],
  hotFiles: [
    { testFile: 'packages/api/tests/flaky.ts', fails: 12, distinctTests: 4 },
  ],
  recentRuns: [
    {
      runId: 'r1',
      startedAt: '2026-04-22T00:00:00.000Z',
      endedAt: '2026-04-22T00:00:05.000Z',
      durationMs: 5000,
      status: 'pass',
      totalTests: 42,
      passedTests: 42,
      failedTests: 0,
      errorsBetweenTests: 0,
      gitSha: 'abc123def456',
      gitDirty: false,
    },
  ],
  failuresByRun: new Map(),
}

describe('renderSummaryStats', () => {
  test('shows a "0 critical" cell when no pattern hits the critical bucket', () => {
    const html = renderSummaryStats([pattern], dashboard, 7)
    expect(html).toContain('stat-strip')
    expect(html).toContain('>0<') // critical cell
    expect(html).toContain('fails / 7d')
  })

  test('no-dashboard variant still renders — hot files / last run fall back', () => {
    const html = renderSummaryStats([pattern], undefined, 14)
    expect(html).toContain('fails / 14d')
    expect(html).toContain('—') // last-run fallback
  })
})

describe('renderToc', () => {
  test('returns an empty container when nothing to index', () => {
    expect(renderToc([], false)).toBe('<div></div>')
  })

  test('includes dashboard links when requested', () => {
    const html = renderToc([], true)
    expect(html).toContain('href="#dashboard"')
    expect(html).toContain('href="#hot-files"')
    expect(html).toContain('href="#recent-runs"')
  })

  test('anchors each pattern to its card id', () => {
    const html = renderToc([pattern], false)
    expect(html).toContain('href="#pattern-1"')
    expect(html).toContain('jobs &gt; enqueue returns an id')
  })
})

describe('renderDashboard', () => {
  test('renders all three aggregate sections', () => {
    const html = renderDashboard(dashboard, 7)
    expect(html).toContain('Failure Kind Breakdown')
    expect(html).toContain('Hot Files')
    expect(html).toContain('Recent Runs')
  })

  test('includes the kind breakdown counts and percentages', () => {
    const html = renderDashboard(dashboard, 7)
    // 10 timeout + 3 assertion = 13 total → 77% and 23%
    expect(html).toContain('>10<')
    expect(html).toContain('>3<')
    expect(html).toContain('77% of failures')
    expect(html).toContain('23% of failures')
  })

  test('renders short SHA and status badge for each run', () => {
    const html = renderDashboard(dashboard, 7)
    expect(html).toContain('abc123d') // 7-char SHA
    expect(html).toContain('status-pass')
  })
})
