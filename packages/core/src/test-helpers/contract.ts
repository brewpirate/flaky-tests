/**
 * Shared IStore contract suite. Every adapter (sqlite/turso/postgres/supabase)
 * invokes `runContractTests(label, makeStore)` so IStore semantics stay locked
 * in: adapter divergence shows up as a test failure at the exact scenario that
 * differs, not as a production regression weeks later.
 *
 * Each test builds a fresh store via the supplied factory and uses unique
 * runIds via `crypto.randomUUID()` so adapters that share a table (postgres,
 * supabase) do not suffer cross-test pollution.
 */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import type { FlakyPattern, IStore, RecentRun } from '#core'
import { MAX_FAILED_TESTS_PER_RUN } from '#core/config/defaults'
import { ValidationError } from '#core/schema/validate-schemas'
import { daysAgo, makeFailure, makeRun } from './fixtures'

/**
 * Invoke the shared contract suite. `makeStore` is called once per test so
 * every scenario starts with fresh store state (for in-memory adapters) or a
 * fresh client (for remote adapters — isolation is then provided by unique
 * runIds generated inside each test).
 */
export function runContractTests(
  label: string,
  makeStore: () => IStore | Promise<IStore>,
): void {
  describe(`IStore contract: ${label}`, () => {
    let store: IStore

    beforeEach(async () => {
      store = await makeStore()
      await store.migrate()
    })

    afterEach(async () => {
      await store.close()
    })

    /** Seed a completed run with the given failures, all under a unique runId. */
    async function seedRun(
      failures: Array<{
        name: string
        daysBack: number
        kind?: 'assertion' | 'timeout' | 'uncaught' | 'unknown'
      }>,
      overrides: { failedTests?: number; runId?: string } = {},
    ): Promise<string> {
      const runId = overrides.runId ?? crypto.randomUUID()
      const startedAt = daysAgo(failures[0]?.daysBack ?? 0)
      await store.insertRun(makeRun(runId, startedAt))
      await store.updateRun(runId, {
        endedAt: new Date().toISOString(),
        status: 'fail',
        totalTests: failures.length + 5,
        passedTests: 5,
        failedTests: overrides.failedTests ?? failures.length,
      })
      for (const failure of failures) {
        await store.insertFailure(
          makeFailure(
            runId,
            failure.name,
            daysAgo(failure.daysBack),
            failure.kind ?? 'assertion',
          ),
        )
      }
      return runId
    }

    // --- Round-trip + validation -------------------------------------------

    test('insertRun → insertFailure → getNewPatterns reflects the failure', async () => {
      const testName = `t-${crypto.randomUUID()}`
      await seedRun([
        { name: testName, daysBack: 1 },
        { name: testName, daysBack: 2 },
      ])
      const patterns = await store.getNewPatterns({
        windowDays: 7,
        threshold: 2,
      })
      const match = patterns.find(
        (pattern: FlakyPattern) => pattern.testName === testName,
      )
      expect(match).toBeDefined()
      expect(match?.recentFails).toBe(2)
      expect(match?.priorFails).toBe(0)
    })

    test('getNewPatterns only counts runs with ended_at set (updateRun finalizes)', async () => {
      const runId = crypto.randomUUID()
      const testName = `t-${crypto.randomUUID()}`
      await store.insertRun(makeRun(runId, daysAgo(1)))
      // NOTE: no updateRun — the run is not finalized.
      await store.insertFailure(makeFailure(runId, testName, daysAgo(1)))
      await store.insertFailure(makeFailure(runId, testName, daysAgo(1)))
      const patterns = await store.getNewPatterns({
        windowDays: 7,
        threshold: 2,
      })
      expect(
        patterns.find((pattern: FlakyPattern) => pattern.testName === testName),
      ).toBeUndefined()
    })

    test('insertFailures batch writes all rows', async () => {
      const runId = crypto.randomUUID()
      const testName = `t-${crypto.randomUUID()}`
      await store.insertRun(makeRun(runId, daysAgo(1)))
      await store.updateRun(runId, {
        endedAt: new Date().toISOString(),
        status: 'fail',
        totalTests: 3,
        passedTests: 1,
        failedTests: 2,
      })
      await store.insertFailures([
        makeFailure(runId, testName, daysAgo(1)),
        makeFailure(runId, testName, daysAgo(2)),
      ])
      const patterns = await store.getNewPatterns({
        windowDays: 7,
        threshold: 2,
      })
      expect(
        patterns.find((pattern: FlakyPattern) => pattern.testName === testName)
          ?.recentFails,
      ).toBe(2)
    })

    test('validation rejects malformed input before touching the DB', async () => {
      await expect(
        store.insertRun({
          runId: '',
          startedAt: 'not-an-iso-timestamp',
        }),
      ).rejects.toBeInstanceOf(ValidationError)
    })

    // --- getNewPatterns pattern detection ----------------------------------

    test('no prior failures + above threshold → flagged', async () => {
      const testName = `t-${crypto.randomUUID()}`
      await seedRun([
        { name: testName, daysBack: 1 },
        { name: testName, daysBack: 2 },
      ])
      const pattern = (
        await store.getNewPatterns({ windowDays: 7, threshold: 2 })
      ).find((p: FlakyPattern) => p.testName === testName)
      expect(pattern).toBeDefined()
      expect(pattern?.recentFails).toBe(2)
      expect(pattern?.priorFails).toBe(0)
    })

    test('prior failures + recent failures → NOT flagged (not newly flaky)', async () => {
      const testName = `t-${crypto.randomUUID()}`
      await seedRun([
        { name: testName, daysBack: 1 },
        { name: testName, daysBack: 2 },
        { name: testName, daysBack: 10 }, // prior window
      ])
      const pattern = (
        await store.getNewPatterns({ windowDays: 7, threshold: 2 })
      ).find((p: FlakyPattern) => p.testName === testName)
      expect(pattern).toBeUndefined()
    })

    test('recent failures below threshold → not flagged', async () => {
      const testName = `t-${crypto.randomUUID()}`
      await seedRun([{ name: testName, daysBack: 1 }])
      const pattern = (
        await store.getNewPatterns({ windowDays: 7, threshold: 2 })
      ).find((p: FlakyPattern) => p.testName === testName)
      expect(pattern).toBeUndefined()
    })

    test('only prior failures → not flagged', async () => {
      const testName = `t-${crypto.randomUUID()}`
      await seedRun([
        { name: testName, daysBack: 10 },
        { name: testName, daysBack: 11 },
      ])
      const pattern = (
        await store.getNewPatterns({ windowDays: 7, threshold: 2 })
      ).find((p: FlakyPattern) => p.testName === testName)
      expect(pattern).toBeUndefined()
    })

    test('window edge: failures just inside windowDays count, just outside do not', async () => {
      const insideName = `inside-${crypto.randomUUID()}`
      const outsideName = `outside-${crypto.randomUUID()}`
      await seedRun([
        { name: insideName, daysBack: 6 },
        { name: insideName, daysBack: 5 },
        { name: outsideName, daysBack: 8 }, // outside 7-day window
        { name: outsideName, daysBack: 9 },
      ])
      const patterns = await store.getNewPatterns({
        windowDays: 7,
        threshold: 2,
      })
      expect(
        patterns.find((p: FlakyPattern) => p.testName === insideName),
      ).toBeDefined()
      expect(
        patterns.find((p: FlakyPattern) => p.testName === outsideName),
      ).toBeUndefined()
    })

    test('custom threshold overrides the default', async () => {
      const testName = `t-${crypto.randomUUID()}`
      await seedRun([
        { name: testName, daysBack: 1 },
        { name: testName, daysBack: 2 },
      ])
      const belowCustom = await store.getNewPatterns({ threshold: 3 })
      const atCustom = await store.getNewPatterns({ threshold: 2 })
      expect(
        belowCustom.find((p: FlakyPattern) => p.testName === testName),
      ).toBeUndefined()
      expect(
        atCustom.find((p: FlakyPattern) => p.testName === testName),
      ).toBeDefined()
    })

    test('multiple patterns sorted by recentFails descending', async () => {
      const heavy = `heavy-${crypto.randomUUID()}`
      const light = `light-${crypto.randomUUID()}`
      await seedRun([
        { name: heavy, daysBack: 1 },
        { name: heavy, daysBack: 2 },
        { name: heavy, daysBack: 3 },
        { name: light, daysBack: 1 },
        { name: light, daysBack: 2 },
      ])
      const patterns = (
        await store.getNewPatterns({ windowDays: 7, threshold: 2 })
      ).filter(
        (p: FlakyPattern) => p.testName === heavy || p.testName === light,
      )
      expect(patterns.map((p: FlakyPattern) => p.testName)).toEqual([
        heavy,
        light,
      ])
      expect(patterns[0]?.recentFails).toBe(3)
      expect(patterns[1]?.recentFails).toBe(2)
    })

    test('collects distinct failure kinds per test', async () => {
      const testName = `t-${crypto.randomUUID()}`
      await seedRun([
        { name: testName, daysBack: 1, kind: 'assertion' },
        { name: testName, daysBack: 2, kind: 'timeout' },
      ])
      const pattern = (
        await store.getNewPatterns({ windowDays: 7, threshold: 2 })
      ).find((p: FlakyPattern) => p.testName === testName)
      expect(pattern?.failureKinds.slice().sort()).toEqual([
        'assertion',
        'timeout',
      ])
    })

    test('lastErrorMessage reflects the most recent failure in the current window', async () => {
      const runId = crypto.randomUUID()
      const testName = `t-${crypto.randomUUID()}`
      await store.insertRun(makeRun(runId, daysAgo(2)))
      await store.updateRun(runId, {
        endedAt: new Date().toISOString(),
        status: 'fail',
        totalTests: 2,
        passedTests: 0,
        failedTests: 2,
      })
      await store.insertFailure({
        ...makeFailure(runId, testName, daysAgo(2)),
        errorMessage: 'older error',
      })
      await store.insertFailure({
        ...makeFailure(runId, testName, daysAgo(1)),
        errorMessage: 'newer error',
      })
      const pattern = (
        await store.getNewPatterns({ windowDays: 7, threshold: 2 })
      ).find((p: FlakyPattern) => p.testName === testName)
      expect(pattern?.lastErrorMessage).toBe('newer error')
    })

    test('excludes runs with failed_tests >= MAX_FAILED_TESTS_PER_RUN (infra blowup filter)', async () => {
      const testName = `t-${crypto.randomUUID()}`
      await seedRun(
        [
          { name: testName, daysBack: 1 },
          { name: testName, daysBack: 2 },
        ],
        { failedTests: MAX_FAILED_TESTS_PER_RUN },
      )
      const pattern = (
        await store.getNewPatterns({ windowDays: 7, threshold: 2 })
      ).find((p: FlakyPattern) => p.testName === testName)
      expect(pattern).toBeUndefined()
    })

    test('getRecentRuns returns inserted runs ordered by startedAt DESC', async () => {
      // Three runs at different times. Unique per-invocation runIds keep
      // shared-table adapters (postgres/supabase) isolated from other tests.
      const suffix = crypto.randomUUID().slice(0, 8)
      const oldest = `recent-old-${suffix}`
      const middle = `recent-mid-${suffix}`
      const newest = `recent-new-${suffix}`

      await store.insertRun(makeRun(oldest, daysAgo(3)))
      await store.updateRun(oldest, {
        endedAt: daysAgo(3).toISOString(),
        status: 'pass',
        totalTests: 5,
        passedTests: 5,
        failedTests: 0,
      })
      await store.insertRun(makeRun(middle, daysAgo(2)))
      await store.updateRun(middle, {
        endedAt: daysAgo(2).toISOString(),
        status: 'fail',
        totalTests: 5,
        passedTests: 4,
        failedTests: 1,
      })
      await store.insertRun(makeRun(newest, daysAgo(1)))
      await store.updateRun(newest, {
        endedAt: daysAgo(1).toISOString(),
        status: 'pass',
        totalTests: 5,
        passedTests: 5,
        failedTests: 0,
      })

      const runs = await store.getRecentRuns({ limit: 100 })
      const ours = runs
        .filter((run: RecentRun) =>
          [oldest, middle, newest].includes(run.runId),
        )
        .map((run: RecentRun) => run.runId)
      expect(ours).toEqual([newest, middle, oldest])
    })

    test('project filter isolates runs: getRecentRuns only returns rows for the requested project', async () => {
      // Seed one run under project "alpha" and one with NULL project.
      const alphaRunId = `proj-alpha-${crypto.randomUUID().slice(0, 8)}`
      const nullRunId = `proj-null-${crypto.randomUUID().slice(0, 8)}`

      await store.insertRun({
        runId: alphaRunId,
        project: 'alpha',
        startedAt: daysAgo(1).toISOString(),
      })
      await store.updateRun(alphaRunId, {
        endedAt: new Date().toISOString(),
        status: 'pass',
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
      })
      await store.insertRun({
        runId: nullRunId,
        startedAt: daysAgo(1).toISOString(),
      })
      await store.updateRun(nullRunId, {
        endedAt: new Date().toISOString(),
        status: 'pass',
        totalTests: 1,
        passedTests: 1,
        failedTests: 0,
      })

      const alphaRuns = await store.getRecentRuns({
        limit: 100,
        project: 'alpha',
      })
      const nullRuns = await store.getRecentRuns({ limit: 100, project: null })

      const alphaIds = alphaRuns.map((run: RecentRun) => run.runId)
      const nullIds = nullRuns.map((run: RecentRun) => run.runId)
      expect(alphaIds).toContain(alphaRunId)
      expect(alphaIds).not.toContain(nullRunId)
      expect(nullIds).toContain(nullRunId)
      expect(nullIds).not.toContain(alphaRunId)

      // Every returned row's `project` field matches the filter.
      for (const run of alphaRuns) {
        expect(run.project).toBe('alpha')
      }
      for (const run of nullRuns) {
        expect(run.project).toBeNull()
      }
    })

    test('close() is idempotent — a second call does not throw', async () => {
      await store.close()
      await expect(store.close()).resolves.toBeUndefined()
    })

    // --- AbortSignal support (read methods) --------------------------------

    test('getNewPatterns rejects with AbortError when signal is pre-aborted', async () => {
      const controller = new AbortController()
      controller.abort()
      const error = await store
        .getNewPatterns({ signal: controller.signal })
        .then(
          () => null,
          (rejection: unknown) => rejection,
        )
      expect(error).not.toBeNull()
      expect((error as { name: string }).name).toBe('AbortError')
    })

    test('getRecentRuns rejects with AbortError when signal is pre-aborted', async () => {
      const controller = new AbortController()
      controller.abort()
      const error = await store
        .getRecentRuns({ limit: 10, signal: controller.signal })
        .then(
          () => null,
          (rejection: unknown) => rejection,
        )
      expect(error).not.toBeNull()
      expect((error as { name: string }).name).toBe('AbortError')
    })
  })
}
