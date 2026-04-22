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
  DescribeStack,
  debugWarn,
  extractMessage,
  extractStack,
} from '@flaky-tests/core'
import { captureGitInfo } from './git'

type TestCallback = (...args: unknown[]) => unknown | Promise<unknown>
type TestFn = (name: string, fn: TestCallback, timeout?: number) => unknown
type DescribeFn = (name: string, body: () => void) => unknown

// Cap on stack scan for resolveTestFile — pathological stacks shouldn't
// pin a test run while we grep every line.
const STACK_SCAN_MAX_LINES = 200

// Bounded accepted form for an externally-provided RUN_ID. Anything outside
// this shape is rejected silently and a fresh UUID is generated instead.
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

// Module-level flag so a preload loaded twice does not double-register
// process listeners or re-mock bun:test.
let installed = false

function sanitizedRunId(raw: string | undefined): string {
  if (raw && RUN_ID_PATTERN.test(raw)) {
    return raw
  }
  return crypto.randomUUID()
}

/** Fire-and-forget an async side-effect that must never throw into the caller. */
function safeVoid(label: string, effect: () => Promise<void>): void {
  effect().catch((error: unknown) => debugWarn(label, error))
}

/**
 * Resolves the test source file from a thrown error's stack by finding the
 * first frame that isn't inside this package. Falls back to `'unknown'`.
 */
function resolveTestFile(error: unknown): string {
  if (!(error instanceof Error) || typeof error.stack !== 'string') {
    return 'unknown'
  }
  const lines = error.stack.split('\n')
  const scanLimit = Math.min(lines.length, STACK_SCAN_MAX_LINES)
  for (let i = 0; i < scanLimit; i++) {
    const line = lines[i]
    if (!line) {
      continue
    }
    const match = line.match(/\(([^)]+\.(?:ts|tsx|js|jsx|mjs|cjs)):\d+:\d+\)/)
    if (!match) {
      continue
    }
    const file = match[1]
    if (!file) {
      continue
    }
    if (file.includes('/plugin-bun/')) {
      continue
    }
    return file
  }
  return 'unknown'
}

/**
 * Monkey-patches `bun:test` to intercept test/describe registrations and
 * record failures to the provided store. Registers an `afterAll` hook to
 * finalize the run with aggregate stats.
 *
 * Idempotent: calling this twice within the same process is a no-op after
 * the first call. Diagnostics use `debugWarn` — set `FLAKY_TESTS_DEBUG=1`
 * to surface them; otherwise the preload is silent.
 *
 * @param store - Storage backend implementing {@link IStore} (e.g. SQLite, Supabase).
 */
export function createPreload(store: IStore): void {
  if (installed) {
    debugWarn('createPreload called twice; ignoring second call')
    return
  }
  installed = true

  const runId = sanitizedRunId(process.env.FLAKY_TESTS_RUN_ID)
  const startedAt = new Date().toISOString()
  const startPerf = performance.now()
  const git = captureGitInfo()

  safeVoid('insertRun', () =>
    store.insertRun({
      runId,
      startedAt,
      gitSha: git.sha,
      gitDirty: git.dirty,
      runtimeVersion: Bun.version,
      testArgs: process.argv.slice(2).join(' '),
    }),
  )

  let testsRun = 0
  let testsFailed = 0
  let errorsBetweenTests = 0
  const describeStack = new DescribeStack()

  // Errors escaping test wrappers — unhandled rejections, module-load throws.
  const onRunLevelError = (error: unknown): void => {
    errorsBetweenTests++
    safeVoid('insertFailure (between-tests)', () =>
      store.insertFailure({
        runId,
        testFile: resolveTestFile(error),
        testName: '<between tests>',
        failureKind: categorizeError(error),
        errorMessage: extractMessage(error),
        errorStack: extractStack(error),
        durationMs: 0,
        failedAt: new Date().toISOString(),
      }),
    )
  }
  process.on('uncaughtException', onRunLevelError)
  process.on('unhandledRejection', onRunLevelError)

  const recordFailure = (opts: {
    testFile: string
    testName: string
    error: unknown
    durationMs: number
  }): void => {
    safeVoid('insertFailure', () =>
      store.insertFailure({
        runId,
        testFile: opts.testFile,
        testName: opts.testName,
        failureKind: categorizeError(opts.error),
        errorMessage: extractMessage(opts.error),
        errorStack: extractStack(opts.error),
        durationMs: Math.round(opts.durationMs),
        failedAt: new Date().toISOString(),
      }),
    )
  }

  // Proxy-based wrapping so sub-APIs like .each, .skip, .only, .todo etc.
  // keep working — they live on the prototype chain, not as own properties.
  const wrapTest = (originalTest: TestFn): TestFn => {
    const callWrapped: TestFn = (name, fn, timeout) => {
      // Preserve `done`-callback style — wrapping would change arity and
      // trigger Bun's async-done timeout.
      if (fn.length > 0) {
        return originalTest(name, fn, timeout)
      }

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

  const wrapDescribe = (originalDescribe: DescribeFn): DescribeFn => {
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
      test: wrapTest(bunTest.test as unknown as TestFn),
      it: wrapTest(bunTest.it as unknown as TestFn),
      describe: wrapDescribe(bunTest.describe as unknown as DescribeFn),
    }))
  } catch (error) {
    debugWarn('monkey-patch bun:test failed', error)
  }

  afterAll(async () => {
    const endedAt = new Date().toISOString()
    const durationMs = Math.round(performance.now() - startPerf)
    const passedTests = Math.max(0, testsRun - testsFailed)
    const status: 'pass' | 'fail' =
      testsFailed > 0 || errorsBetweenTests > 0 ? 'fail' : 'pass'

    await store
      .updateRun(runId, {
        endedAt,
        durationMs,
        status,
        totalTests: testsRun,
        passedTests,
        failedTests: testsFailed,
        errorsBetweenTests,
      })
      .catch((error: unknown) => debugWarn('updateRun failed', error))

    await store
      .close()
      .catch((error: unknown) => debugWarn('close failed', error))
  })
}
