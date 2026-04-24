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
 * reconciled to 'fail' and errors_between_tests is incremented. Reconciliation
 * is SQLite-only today (relies on `SqliteStore.reconcileRun`), so non-sqlite
 * configs skip it with a debug log and the run's status stays whatever the
 * preload wrote.
 */

// biome-ignore-all lint/suspicious/noConsole: CLI wrapper

import {
  createLogger,
  publishRunIdForSubprocess,
  resolveConfig,
} from '@flaky-tests/core'

const log = createLogger('run-tracked')

/** Dynamic import whose specifier is string-typed at the call site so tsc
 *  does not attempt to statically resolve it. Used for optional peers
 *  whose `dist/*.d.ts` may not be built during plugin-bun's typecheck. */
async function loadOptionalModule<T>(spec: string): Promise<T> {
  return (await import(spec)) as T
}
const config = resolveConfig()
const DB_PATH: string =
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

/**
 * Flips a recorded-as-pass run to fail when the subprocess exited non-zero.
 * SQLite-only: uses `SqliteStore.reconcileRun`, which isn't in IStore and
 * can't be ported to remote stores without a network round-trip we'd rather
 * skip here. For non-sqlite configs we leave the run as-recorded and debug-log.
 */
async function reconcileRun(runId: string): Promise<void> {
  if (config.store.type !== 'sqlite') {
    log.debug(
      `reconcileRun: skipped (store.type=${config.store.type}; only sqlite supports in-process reconcile)`,
    )
    return
  }
  try {
    if (!(await Bun.file(DB_PATH).exists())) {
      // DB doesn't exist — preload never ran or a different path is in use.
      return
    }
    // Dynamic import via a string-typed variable so tsc doesn't try to
    // statically resolve the specifier. store-sqlite is an optional peer
    // (its dist types may not exist during plugin-bun's build:types run),
    // and we only touch a tiny slice of its surface here — the inline
    // interface captures exactly what's needed.
    interface SqliteStoreModule {
      SqliteStore: new (options: {
        dbPath?: string
      }) => {
        migrate(): Promise<void>
        reconcileRun(runId: string): Promise<void>
        close(): Promise<void>
      }
    }
    const mod = await loadOptionalModule<SqliteStoreModule>(
      '@flaky-tests/store-sqlite',
    )
    const store = new mod.SqliteStore({ dbPath: DB_PATH })
    try {
      // Ensure the schema is present before reconciling — the store no
      // longer auto-migrates in the constructor (libsql is async).
      await store.migrate()
      await store.reconcileRun(runId)
    } finally {
      await store.close()
    }
  } catch (error) {
    console.warn('[flaky-tests] reconcile failed:', error)
  }
}

process.exit(await main())
