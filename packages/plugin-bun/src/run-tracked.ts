/**
 * Authoritative test runner — spawns `bun test` as a subprocess so the real
 * exit code is observable from outside the test process.
 *
 * This addresses the limitation where module-load errors (TypeError at
 * describe-registration time) are reported by Bun but invisible to any
 * in-process observer. The exit code is the only authoritative signal.
 *
 * Usage:
 *   bun run @flaky-tests/plugin-bun/run-tracked [bun-test-args...]
 *
 * On non-zero exit, if the preload recorded status='pass', the run is
 * reconciled to 'fail' and errors_between_tests is incremented.
 */

// biome-ignore-all lint/suspicious/noConsole: CLI wrapper

import { publishRunIdForSubprocess, resolveConfig } from '@flaky-tests/core'
import { SqliteStore } from '@flaky-tests/store-sqlite'

const config = resolveConfig()
const DB_PATH =
  config.store.type === 'sqlite' && config.store.path !== undefined
    ? config.store.path
    : 'node_modules/.cache/flaky-tests/failures.db'

/** Spawns `bun test` as a child so the authoritative exit code survives module-load errors the preload cannot observe in-process. */
async function main(): Promise<number> {
  const runId = crypto.randomUUID()
  const forwardedArgs = process.argv.slice(2)

  // Publish the generated run id so the child's preload picks it up via
  // `resolveConfig().plugin.runIdOverride`. Bun.spawn inherits process.env
  // when `env` is omitted; the helper lives in core so env access stays in
  // one module.
  publishRunIdForSubprocess(runId)
  const child = Bun.spawn({
    cmd: ['bun', 'test', ...forwardedArgs],
    stdout: 'inherit',
    stderr: 'inherit',
    stdin: 'inherit',
  })
  const exitCode = await child.exited

  if (exitCode !== 0) {
    await reconcileRun(runId)
  }
  return exitCode
}

/** Flips a recorded-as-pass run to fail when the subprocess exited non-zero, catching failures that never surfaced as test-level errors. */
async function reconcileRun(runId: string): Promise<void> {
  try {
    if (!(await Bun.file(DB_PATH).exists())) {
      // DB doesn't exist — preload never ran or a different path is in use.
      return
    }
    const store = new SqliteStore({ dbPath: DB_PATH })
    try {
      store.reconcileRun(runId)
    } finally {
      await store.close()
    }
  } catch (error) {
    console.warn('[flaky-tests] reconcile failed:', error)
  }
}

process.exit(await main())
