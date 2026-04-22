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

import { debugWarn } from '@flaky-tests/core'
import { SqliteStore } from '@flaky-tests/store-sqlite'

const DEFAULT_DB_PATH = 'node_modules/.cache/flaky-tests/failures.db'

function resolveDbPath(): string {
  return process.env.FLAKY_TESTS_DB ?? DEFAULT_DB_PATH
}

async function main(): Promise<number> {
  const runId = crypto.randomUUID()
  const forwardedArgs = process.argv.slice(2)

  const child = Bun.spawn({
    cmd: ['bun', 'test', ...forwardedArgs],
    env: { ...process.env, FLAKY_TESTS_RUN_ID: runId },
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

async function reconcileRun(runId: string): Promise<void> {
  const dbPath = resolveDbPath()
  try {
    if (!(await Bun.file(dbPath).exists())) {
      // DB doesn't exist — preload never ran or a different path is in use.
      return
    }
    const store = new SqliteStore({ dbPath })
    try {
      store.reconcileRun(runId)
    } finally {
      await store.close()
    }
  } catch (error) {
    debugWarn('reconcile failed', error)
  }
}

try {
  const exitCode = await main()
  process.exit(exitCode)
} catch (error) {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error)
  console.error(`[flaky-tests] run-tracked failed:\n${message}`)
  process.exit(1)
}
