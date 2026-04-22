/**
 * Tests for the createPreload function's store interactions.
 *
 * NOTE: createPreload() monkey-patches bun:test, which makes it difficult
 * to test in isolation within a bun:test runner (it would patch itself).
 * These tests verify the store contract expectations by testing the
 * integration outcome — they call createPreload with a mock store and
 * verify the expected calls were made during initialization.
 *
 * The afterAll hook (which calls updateRun + close) fires after all tests
 * in the file complete, so we verify insertRun during the test and
 * updateRun/close in afterAll (not directly testable from within tests).
 */

import { describe, expect, test } from 'bun:test'
import type {
  FlakyPattern,
  GetNewPatternsOptions,
  InsertRunInput,
  IStore,
} from '@flaky-tests/core'
import { isInstalledForTesting } from './preload'

// Skip when a real preload already wired bun:test (e.g. the monorepo's
// own dogfood bunfig at the repo root). The `installed` guard is
// irreversible — mock.module and afterAll registrations can't be
// cleanly undone — so a second createPreload call against this already-
// mounted state would no-op and the assertion below would fail.
// Coverage for this path lives in the pending-writes + live-integration
// tests when dogfood is active.
const SKIP_IF_PRELOAD_ACTIVE = isInstalledForTesting()

describe.skipIf(SKIP_IF_PRELOAD_ACTIVE)('createPreload store contract', () => {
  test('createPreload calls insertRun on initialization', async () => {
    const insertRunCalls: InsertRunInput[] = []

    const mockStore: IStore = {
      async migrate() {},
      async insertRun(input) {
        insertRunCalls.push(input)
      },
      async updateRun(_runId, _input) {},
      async insertFailure(_input) {},
      async insertFailures(_inputs) {},
      async getNewPatterns(
        _options?: GetNewPatternsOptions,
      ): Promise<FlakyPattern[]> {
        return []
      },
      async getRecentRuns() {
        return []
      },
      async getFailuresForRuns() {
        return []
      },
      async close() {},
    }

    // Dynamic import to avoid side effects at module level
    const { createPreload } = await import('./preload')
    createPreload(mockStore)

    // insertRun is called via safeVoid (fire-and-forget), give it a tick
    await new Promise((resolve) => setTimeout(resolve, 50))

    expect(insertRunCalls.length).toBeGreaterThanOrEqual(1)
    const run = insertRunCalls[0]
    expect(run?.runId).toBeString()
    expect(run?.startedAt).toBeString()
    expect(run?.runtimeVersion).toBeString()
  })
})
