/**
 * Track fire-and-forget async writes so the preload's `afterAll` hook can
 * drain them before the run is finalized.
 *
 * Isolated in its own module so the drain contract is directly testable —
 * the interaction with bun:test's `afterAll` timing is hard to exercise
 * from inside bun:test itself, so we verify the drain mechanism in a unit
 * test and trust the integration.
 *
 * See issue #44 for the bug this guards against: remote-store writes
 * (Turso/Supabase/Postgres) are HTTP round-trips that don't complete
 * before `process.exit`, and the preload was losing them.
 */

import type { Logger } from '@flaky-tests/core'

export interface PendingWriteTracker {
  /** Kick off an async side-effect; it's awaited later by {@link drain}. */
  track(label: string, effect: () => Promise<void>): void
  /** Await every currently-tracked promise; safe to call when empty. */
  drain(): Promise<void>
  /** Test-only visibility into the outstanding queue size. */
  readonly size: number
}

/** Factory so each preload instance gets its own tracker (and tests can
 *  spin up isolated instances without module-global state leaking). */
export function createPendingWriteTracker(log: Logger): PendingWriteTracker {
  const pending = new Set<Promise<unknown>>()

  function track(label: string, effect: () => Promise<void>): void {
    const promise: Promise<unknown> = effect()
      .catch((error: unknown) => log.warn(`${label}:`, error))
      .finally(() => pending.delete(promise))
    pending.add(promise)
  }

  async function drain(): Promise<void> {
    if (pending.size === 0) {
      return
    }
    // allSettled (not all) so one slow/failed write doesn't mask another's
    // error and doesn't short-circuit the drain itself.
    await Promise.allSettled([...pending])
  }

  return {
    track,
    drain,
    get size(): number {
      return pending.size
    },
  }
}
