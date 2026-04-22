/**
 * Regression tests for the fire-and-forget drain mechanism used by the
 * Bun preload. See issue #44 — without this drain, remote-store writes
 * are orphaned when Bun exits the process.
 */

import { describe, expect, mock, test } from 'bun:test'
import type { Logger } from '@flaky-tests/core'
import { createPendingWriteTracker } from './pending-writes'

function silentLogger(): Logger {
  return {
    error: mock(() => {}),
    warn: mock(() => {}),
    debug: mock(() => {}),
  }
}

/** Construct a manually-settleable promise so tests can control timing. */
function deferred<T = void>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createPendingWriteTracker', () => {
  test('drain() waits for every tracked promise to settle before resolving', async () => {
    const tracker = createPendingWriteTracker(silentLogger())

    const first = deferred()
    const second = deferred()
    const completed: string[] = []

    tracker.track('first', async () => {
      await first.promise
      completed.push('first')
    })
    tracker.track('second', async () => {
      await second.promise
      completed.push('second')
    })

    expect(tracker.size).toBe(2)

    let drained = false
    const drainPromise = tracker.drain().then(() => {
      drained = true
    })

    // Drain must still be pending until both tracked writes settle.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(drained).toBe(false)
    expect(completed).toEqual([])

    // Settle them in order; drain resolves only after both complete.
    first.resolve()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(drained).toBe(false)

    second.resolve()
    await drainPromise
    expect(drained).toBe(true)
    expect(completed.sort()).toEqual(['first', 'second'])
  })

  test('completed promises remove themselves from the queue', async () => {
    const tracker = createPendingWriteTracker(silentLogger())
    const fast = deferred()

    tracker.track('fast', async () => {
      await fast.promise
    })
    expect(tracker.size).toBe(1)

    fast.resolve()
    // Microtask + finally hop.
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(tracker.size).toBe(0)
  })

  test('drain() is a no-op when nothing is tracked', async () => {
    const tracker = createPendingWriteTracker(silentLogger())
    await expect(tracker.drain()).resolves.toBeUndefined()
  })

  test('drain() still resolves when a tracked write rejects', async () => {
    const log = silentLogger()
    const tracker = createPendingWriteTracker(log)
    const ok = deferred()

    tracker.track('boom', async () => {
      throw new Error('write failed')
    })
    tracker.track('ok', async () => {
      await ok.promise
    })

    let drained = false
    const drainPromise = tracker.drain().then(() => {
      drained = true
    })

    // Can't resolve yet — 'ok' is still pending.
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(drained).toBe(false)

    ok.resolve()
    await drainPromise
    expect(drained).toBe(true)
    // The rejection was caught and surfaced via log.warn, not propagated.
    expect(log.warn).toHaveBeenCalled()
  })

  test('track() inside a still-pending drain is NOT observed (snapshot semantics)', async () => {
    // Drain awaits the set of promises present when it was called. Writes
    // registered AFTER drain started are the caller's responsibility —
    // preload registers every write before afterAll fires drain, so the
    // snapshot semantics match usage.
    const tracker = createPendingWriteTracker(silentLogger())
    const first = deferred()

    tracker.track('first', async () => {
      await first.promise
    })

    const drainPromise = tracker.drain()

    const lateDeferred = deferred()
    tracker.track('late', async () => {
      await lateDeferred.promise
    })

    first.resolve()
    await drainPromise

    // `late` was added AFTER the drain snapshotted, so drain resolved
    // without waiting for it. Document the behavior.
    expect(tracker.size).toBe(1)
    lateDeferred.resolve()
  })
})
