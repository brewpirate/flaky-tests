/**
 * Core Bun preload logic. Monkey-patches `bun:test` so every test/it/describe
 * call records failures to the provided IStore.
 *
 * Most users should use the default `@flaky-tests/plugin-bun/preload` export
 * which wires this up to a SQLite store automatically.
 *
 * For custom stores (Supabase, Postgres, etc.) create your own preload file:
 *
 *   // my-preload.ts
 *   import { createPreload } from '@flaky-tests/plugin-bun'
 *   import { SupabaseStore } from '@flaky-tests/store-supabase'
 *
 *   createPreload(new SupabaseStore({ url: '...', key: '...' }))
 *
 * Then in bunfig.toml:
 *
 *   [test]
 *   preload = ["./my-preload.ts"]
 */

import * as bunTest from 'bun:test'
import { afterAll, mock } from 'bun:test'
import type { IStore } from '@flaky-tests/core'
import {
  categorizeError,
  createLogger,
  DescribeStack,
  extractMessage,
  extractStack,
  insertFailureInputSchema,
  insertRunInputSchema,
  parse,
  resolveConfig,
  updateRunInputSchema,
} from '@flaky-tests/core'
import { captureGitInfo } from './git'

const log = createLogger('plugin-bun')

type TestCallback = (...args: unknown[]) => unknown | Promise<unknown>
type TestFn = (name: string, fn: TestCallback, timeout?: number) => unknown
type DescribeFn = (name: string, body: () => void) => unknown

/** Accept only safe characters from env-provided RUN_ID. */
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** Bound on stack lines scanned when resolving a test file — stacks can be huge. */
const STACK_SCAN_MAX_LINES = 200

/** Module-level idempotency guard — double-registration would double-count everything. */
let installed = false

/** Outstanding fire-and-forget writes. `afterAll` drains this before the
 *  run is finalized — without the drain, remote-store writes (Turso,
 *  Supabase, Postgres) get orphaned mid-flight when Bun exits and silently
 *  drop test data. See issue #44. */
const pendingWrites = new Set<Promise<unknown>>()

/** Kick off an async side-effect that must never throw into the caller.
 *  The returned promise is tracked in {@link pendingWrites} so the run's
 *  `afterAll` can wait for in-flight writes before closing the store. */
function safeVoid(label: string, effect: () => Promise<void>): void {
  const promise: Promise<unknown> = effect()
    .catch((error: unknown) => log.warn(`${label}:`, error))
    .finally(() => pendingWrites.delete(promise))
  pendingWrites.add(promise)
}

/**
 * Resolves the test source file from a thrown error's stack by finding the
 * first frame that isn't inside this package. Falls back to `'unknown'`.
 */
function resolveTestFile(error: unknown): string {
  if (!(error instanceof Error) || typeof error.stack !== 'string') {
    log.debug(
      `resolveTestFile: fallback=unknown (reason=${error instanceof Error ? 'no stack' : 'non-Error throw'})`,
    )
    return 'unknown'
  }
  const lines = error.stack.split('\n')
  const limit = Math.min(lines.length, STACK_SCAN_MAX_LINES)
  for (let i = 0; i < limit; i++) {
    const line = lines[i] ?? ''
    const match = line.match(/\(([^)]+\.(?:ts|tsx|js|jsx|mjs|cjs)):\d+:\d+\)/)
    if (!match) continue
    const file = match[1] ?? ''
    if (file.includes('/plugin-bun/')) continue
    return file
  }
  log.debug(
    `resolveTestFile: fallback=unknown (scanned ${limit} frames, no non-plugin frame found; first frame: ${lines[0]?.trim() ?? 'none'})`,
  )
  return 'unknown'
}

/**
 * Monkey-patches `bun:test` to intercept test/describe registrations and
 * record failures to the provided store. Registers an `afterAll` hook to
 * finalize the run with aggregate stats.
 *
 * @param store - Storage backend implementing {@link IStore} (e.g. SQLite, Supabase).
 */
export function createPreload(store: IStore): void {
  if (installed) {
    log.warn('createPreload called twice — ignoring')
    return
  }
  installed = true

  // Use a run id provided by run-tracked (so it can reconcile the row post-exit)
  // or generate a fresh one. Reject garbage from the config override.
  const providedRunId = resolveConfig().plugin.runIdOverride
  const runIdFromEnv =
    providedRunId !== undefined && RUN_ID_PATTERN.test(providedRunId)
  const runId = runIdFromEnv ? providedRunId : crypto.randomUUID()
  const startedAt = new Date().toISOString()
  const startPerf = performance.now()
  const git = captureGitInfo()
  log.debug(
    `createPreload: runId=${runId} (source=${runIdFromEnv ? 'FLAKY_TESTS_RUN_ID' : 'generated'}), gitSha=${git.sha ?? 'none'}, gitDirty=${git.dirty}, bunVersion=${Bun.version}`,
  )

  safeVoid('insertRun', () =>
    store.insertRun(
      parse(insertRunInputSchema, {
        runId,
        startedAt,
        gitSha: git.sha,
        gitDirty: git.dirty,
        runtimeVersion: Bun.version,
        testArgs: process.argv.slice(2).join(' '),
      }),
    ),
  )

  let testsRun = 0
  let testsFailed = 0
  let errorsBetweenTests = 0
  const describeStack = new DescribeStack()

  /** Records failures that escape the test wrappers — unhandled rejections and module-load throws — under a synthetic test name so they're still attributable to this run. Attached via `process.on('uncaughtException'|'unhandledRejection')`. */
  const onRunLevelError = (error: unknown): void => {
    errorsBetweenTests++
    safeVoid('insertFailure (between-tests)', () =>
      store.insertFailure(
        parse(insertFailureInputSchema, {
          runId,
          testFile: resolveTestFile(error),
          testName: '<between tests>',
          failureKind: categorizeError(error),
          errorMessage: extractMessage(error),
          errorStack: extractStack(error),
          durationMs: 0,
          failedAt: new Date().toISOString(),
        }),
      ),
    )
  }
  process.on('uncaughtException', onRunLevelError)
  process.on('unhandledRejection', onRunLevelError)

  /** Shared failure writer for the per-test wrapper. Normalizes the error through the core schemas before handing off to the store. */
  const recordFailure = (opts: {
    testFile: string
    testName: string
    error: unknown
    durationMs: number
  }): void => {
    safeVoid('insertFailure', () =>
      store.insertFailure(
        parse(insertFailureInputSchema, {
          runId,
          testFile: opts.testFile,
          testName: opts.testName,
          failureKind: categorizeError(opts.error),
          errorMessage: extractMessage(opts.error),
          errorStack: extractStack(opts.error),
          durationMs: Math.round(opts.durationMs),
          failedAt: new Date().toISOString(),
        }),
      ),
    )
  }

  /**
   * Proxy-wraps Bun's `test`/`it` so every call times itself and forwards
   * thrown errors to the store. Proxy (not a plain wrapper) is required so
   * sub-APIs like `.each`, `.skip`, `.only`, `.todo` keep working — they
   * live on the prototype chain, not as own properties.
   */
  const wrapTest = (originalTest: TestFn): TestFn => {
    /** Per-invocation wrapper that measures duration and records thrown errors before rethrowing so Bun still reports the failure. */
    const callWrapped: TestFn = (name, fn, timeout) => {
      // Preserve `done`-callback style — wrapping would change arity and
      // trigger Bun's async-done timeout.
      if (fn.length > 0) return originalTest(name, fn, timeout)

      const fullPath = describeStack.path(name)
      const wrappedFn: TestCallback = async () => {
        testsRun++
        const t0 = performance.now()
        try {
          await fn()
        } catch (error) {
          testsFailed++
          recordFailure({
            testFile: resolveTestFile(error),
            testName: fullPath,
            error,
            durationMs: performance.now() - t0,
          })
          throw error
        }
      }
      return originalTest(name, wrappedFn, timeout)
    }
    return new Proxy(originalTest, {
      apply: (_t, _th, args) =>
        callWrapped(
          args[0] as string,
          args[1] as TestCallback,
          args[2] as number | undefined,
        ),
      // Forward property access (.each, .skip, ...) to the original.
      // Bun's sub-APIs have strict `this` validation — bind to the real target.
      get: (target, prop) => {
        const value = Reflect.get(target, prop, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as TestFn
  }

  /** Proxy-wraps `describe` so we can track the nested path for fully-qualified test names. Uses the same proxy pattern as {@link wrapTest} to preserve chained sub-APIs. */
  const wrapDescribe = (originalDescribe: DescribeFn): DescribeFn => {
    /** Snapshots the describe path eagerly since Bun executes nested describe bodies after the outer frame has left the live stack. */
    const callWrapped: DescribeFn = (name, body) => {
      // Capture path synchronously — Bun defers nested describe body execution
      // past the point where the outer frame is still on the live stack.
      const capturedFrames = [...describeStack.snapshot, name]
      return originalDescribe(name, () =>
        describeStack.runWithFrames(capturedFrames, body),
      )
    }
    return new Proxy(originalDescribe, {
      apply: (_t, _th, args) =>
        callWrapped(args[0] as string, args[1] as () => void),
      get: (target, prop) => {
        const value = Reflect.get(target, prop, target)
        return typeof value === 'function' ? value.bind(target) : value
      },
    }) as DescribeFn
  }

  try {
    mock.module('bun:test', () => ({
      ...bunTest,
      // Bun's test/it/describe types don't expose the internal signature we need for wrapping
      test: wrapTest(bunTest.test as unknown as TestFn),
      it: wrapTest(bunTest.it as unknown as TestFn),
      describe: wrapDescribe(bunTest.describe as unknown as DescribeFn),
    }))
  } catch (error) {
    log.warn('monkey-patch bun:test failed:', error)
  }

  // Wired via `afterAll` — finalizes the run row with aggregate stats and closes the store.
  afterAll(async () => {
    const endedAt = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startPerf)
    // Clamp against counter skew — e.g. a test throwing outside the wrapper
    // could increment failures without a matching testsRun++.
    const passedTests = Math.max(0, testsRun - testsFailed)
    const status: 'pass' | 'fail' =
      testsFailed > 0 || errorsBetweenTests > 0 ? 'fail' : 'pass'
    log.debug(
      `afterAll: runId=${runId}, status=${status}, total=${testsRun}, passed=${passedTests}, failed=${testsFailed}, errorsBetweenTests=${errorsBetweenTests}, durationMs=${durationMs}, pendingWrites=${pendingWrites.size}`,
    )

    // Drain in-flight writes before finalizing. allSettled (not all) so
    // one slow/failed network write doesn't hide another's error, and so
    // the updateRun/close still run even if a write rejects.
    if (pendingWrites.size > 0) {
      await Promise.allSettled([...pendingWrites])
    }

    await store
      .updateRun(
        runId,
        parse(updateRunInputSchema, {
          endedAt,
          durationMs,
          status,
          totalTests: testsRun,
          passedTests,
          failedTests: testsFailed,
          errorsBetweenTests,
        }),
      )
      .catch((e: unknown) => log.warn('updateRun failed:', e))

    await store.close().catch((e: unknown) => log.warn('close failed:', e))
  })
}
