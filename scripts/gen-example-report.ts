import { writeFileSync } from 'node:fs'
import type { FlakyPattern } from '@flaky-tests/core'
import {
  generateHtml,
  type HotFile,
  type KindBreakdown,
  type RecentRun,
  type RunFailure,
} from '../packages/core/src/cli/html'

const now = Date.now()
const iso = (offsetMs: number) => new Date(now - offsetMs).toISOString()

const patterns: FlakyPattern[] = [
  {
    testFile: 'packages/api/tests/auth/login.test.ts',
    testName: 'auth > login > rejects expired refresh token',
    recentFails: 12,
    priorFails: 0,
    failureKinds: ['timeout'],
    lastErrorMessage: 'Expected redirect within 2000ms — got 3104ms',
    lastErrorStack:
      'Error: Expected redirect within 2000ms\n    at login.test.ts:84:23\n    at processTicksAndRejections (node:internal/process/task_queues:95:5)',
    lastFailed: iso(1000 * 60 * 12),
  },
  {
    testFile: 'packages/worker/tests/queue/dispatch.test.ts',
    testName: 'queue > dispatch > retries on transient redis error',
    recentFails: 7,
    priorFails: 1,
    failureKinds: ['assertion', 'timeout'],
    lastErrorMessage: 'AssertionError: expected 2 to equal 3',
    lastErrorStack: 'AssertionError\n    at dispatch.test.ts:210:14',
    lastFailed: iso(1000 * 60 * 60 * 3),
  },
  {
    testFile: 'packages/ui/tests/modal.test.tsx',
    testName: 'Modal > closes on escape key',
    recentFails: 4,
    priorFails: 0,
    failureKinds: ['uncaught'],
    lastErrorMessage: 'TypeError: Cannot read properties of undefined (reading "focus")',
    lastErrorStack: null,
    lastFailed: iso(1000 * 60 * 60 * 20),
  },
  {
    testFile: 'packages/billing/tests/stripe-webhook.test.ts',
    testName: 'stripe webhook > verifies signature across clock skew',
    recentFails: 3,
    priorFails: 0,
    failureKinds: ['assertion'],
    lastErrorMessage: 'Expected signature to be valid',
    lastErrorStack: null,
    lastFailed: iso(1000 * 60 * 60 * 48),
  },
]

const kindBreakdown: KindBreakdown[] = [
  { failureKind: 'timeout', count: 38 },
  { failureKind: 'assertion', count: 24 },
  { failureKind: 'uncaught', count: 9 },
  { failureKind: 'unknown', count: 2 },
]

const hotFiles: HotFile[] = [
  { testFile: 'packages/api/tests/auth/login.test.ts', fails: 18, distinctTests: 3 },
  { testFile: 'packages/worker/tests/queue/dispatch.test.ts', fails: 11, distinctTests: 2 },
  { testFile: 'packages/ui/tests/modal.test.tsx', fails: 6, distinctTests: 4 },
  { testFile: 'packages/billing/tests/stripe-webhook.test.ts', fails: 4, distinctTests: 1 },
]

const runs: RecentRun[] = Array.from({ length: 12 }, (_, i) => {
  const failed = i % 3 === 0 ? Math.max(1, 5 - i) : 0
  return {
    runId: `run-${String(2000 - i).padStart(4, '0')}`,
    startedAt: iso(1000 * 60 * 60 * (i * 2 + 1)),
    endedAt: iso(1000 * 60 * 60 * (i * 2 + 1) - 1000 * 60 * 2),
    durationMs: 90_000 + i * 1200,
    totalTests: 842,
    passedTests: 842 - failed,
    failedTests: failed,
    errorsBetweenTests: 0,
    status: failed > 0 ? ('fail' as const) : ('pass' as const),
    gitSha: `abc${(1234 + i).toString(16)}def0000000000000000000000000`,
    gitDirty: false,
  }
})

const failuresByRun = new Map<string, RunFailure[]>()
failuresByRun.set(runs[0].runId, [
  {
    testName: 'auth > login > rejects expired refresh token',
    testFile: 'packages/api/tests/auth/login.test.ts',
    failureKind: 'timeout',
    errorMessage: 'Expected redirect within 2000ms — got 3104ms',
    failedAt: iso(1000 * 60 * 12),
  },
])

const html = generateHtml(patterns, 7, {
  recentRuns: runs,
  kindBreakdown,
  hotFiles,
  failuresByRun,
})

const outPath = '/tmp/flaky-example-report.html'
writeFileSync(outPath, html, 'utf8')
console.log(outPath)
