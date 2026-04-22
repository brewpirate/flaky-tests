/**
 * Vitest reporter for flaky-tests.
 *
 * Usage in vitest.config.ts:
 *
 *   import { FlakyTestsReporter } from '@flaky-tests/plugin-vitest'
 *   import { SqliteStore } from '@flaky-tests/store-sqlite'
 *   // or: import { SupabaseStore } from '@flaky-tests/store-supabase'
 *   // or: import { PostgresStore } from '@flaky-tests/store-postgres'
 *
 *   export default defineConfig({
 *     test: {
 *       reporters: [
 *         'default',
 *         new FlakyTestsReporter(new SqliteStore()),
 *       ],
 *     },
 *   })
 */

import { execFileSync } from 'node:child_process'
import type {
  Config,
  InsertFailureInput,
  IStore,
  RunCommand,
} from '@flaky-tests/core'
import {
  captureGitInfo as captureGitInfoCore,
  categorizeError,
  createLogger,
  definePlugin,
  extractMessage,
  extractStack,
  insertFailureInputSchema,
  insertRunInputSchema,
  parse,
  updateRunInputSchema,
} from '@flaky-tests/core'

const log = createLogger('plugin-vitest')

/** Synchronous subprocess runner injected into core git helpers; swallows errors so missing git never breaks the reporter. */
const runCommand: RunCommand = (command, args) => {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    })
  } catch {
    return null
  }
}

/** Thin wrapper binding the local subprocess runner to core's git capture so callers get sha/dirty without plumbing. */
function captureGitInfo() {
  return captureGitInfoCore(runCommand)
}

// Minimal task-shape typings that work across Vitest 1.x / 2.x / 3.x.
interface TaskResult {
  state?: string
  errors?: unknown[]
  duration?: number
}

interface TaskBase {
  id: string
  name: string
  type: string
  result?: TaskResult
  file?: { filepath: string }
  suite?: TaskBase
  tasks?: TaskBase[]
}

/**
 * Builds a human-readable test path by walking up the suite hierarchy.
 * Example output: `"outer suite > inner suite > test name"`.
 */
function getTestPath(task: TaskBase): string {
  const parts: string[] = [task.name]
  let current = task.suite
  while (current && current.type === 'suite') {
    parts.unshift(current.name)
    current = current.suite
  }
  return parts.join(' > ')
}

/** Recursively visits every task (tests and suites) in a task tree. */
function walkTasks(
  tasks: readonly TaskBase[],
  visit: (task: TaskBase) => void,
): void {
  for (const task of tasks) {
    visit(task)
    if (task.tasks) walkTasks(task.tasks, visit)
  }
}

/**
 * Vitest custom reporter that records test failures to a flaky-tests store.
 *
 * Implements Vitest's `Reporter` interface (the `onInit` / `onFinished`
 * lifecycle hooks) and is compatible with Vitest 1.x, 2.x, and 3.x.
 *
 * @example
 * ```ts
 * // vitest.config.ts
 * export default defineConfig({
 *   test: {
 *     reporters: ['default', new FlakyTestsReporter(new SqliteStore())],
 *   },
 * })
 * ```
 */
export class FlakyTestsReporter {
  private store: IStore
  private runId: string = crypto.randomUUID()
  private startTime: number = performance.now()
  private ready = false

  /**
   * @param store - Backend store implementation (e.g. SqliteStore, SupabaseStore)
   *               that persists run and failure records.
   */
  constructor(store: IStore) {
    this.store = store
  }

  /** Called once when Vitest initialises. */
  async onInit(_ctx: unknown): Promise<void> {
    this.ready = true
    const git = captureGitInfo()
    log.debug(
      `onInit: runId=${this.runId}, gitSha=${git.sha ?? 'none'}, gitDirty=${git.dirty}, nodeVersion=${process.version}`,
    )
    await this.store
      .insertRun(
        parse(insertRunInputSchema, {
          runId: this.runId,
          startedAt: new Date().toISOString(),
          gitSha: git.sha,
          gitDirty: git.dirty,
          runtimeVersion: process.version,
          testArgs: process.argv.slice(2).join(' '),
        }),
      )
      .catch((e: unknown) => log.warn('insertRun failed:', e))
  }

  /**
   * Called after all test files have finished. Collects failures from the
   * completed file list and writes the final run record.
   *
   * Note: in watch mode this fires after each re-run. Each re-run produces a
   * new run row (run_id is stable per reporter instance, so subsequent reruns
   * overwrite the same row — create a new reporter instance per run if you
   * want separate rows).
   *
   * @param files - Completed file tasks containing nested test results.
   * @param errors - Unhandled errors that occurred between tests.
   */
  async onFinished(
    files: readonly TaskBase[] = [],
    errors: readonly unknown[] = [],
  ): Promise<void> {
    if (!this.ready) return

    let totalTests = 0
    let passedTests = 0
    let failedTests = 0
    const failureInputs: InsertFailureInput[] = []

    for (const file of files) {
      walkTasks(file.tasks ?? [], (task) => {
        if (task.type !== 'test' && task.type !== 'custom') return
        const result = task.result
        if (!result) return
        totalTests++
        if (result.state === 'pass') passedTests++
        if (result.state === 'fail') {
          failedTests++
          const firstError = (result.errors ?? [])[0]
          failureInputs.push(
            parse(insertFailureInputSchema, {
              runId: this.runId,
              testFile: task.file?.filepath ?? 'unknown',
              testName: getTestPath(task),
              failureKind: categorizeError(firstError),
              errorMessage:
                firstError != null ? extractMessage(firstError) : null,
              errorStack: firstError != null ? extractStack(firstError) : null,
              durationMs:
                result.duration != null ? Math.round(result.duration) : null,
              failedAt: new Date().toISOString(),
            }),
          )
        }
      })
    }

    const status = failedTests > 0 || errors.length > 0 ? 'fail' : 'pass'
    const durationMs = Math.round(performance.now() - this.startTime)
    log.debug(
      `onFinished: runId=${this.runId}, status=${status}, total=${totalTests}, passed=${passedTests}, failed=${failedTests}, errorsBetweenTests=${errors.length}, durationMs=${durationMs}`,
    )

    await this.store
      .insertFailures(failureInputs)
      .catch((e: unknown) => log.warn('insertFailures failed:', e))

    await this.store
      .updateRun(
        this.runId,
        parse(updateRunInputSchema, {
          endedAt: new Date().toISOString(),
          durationMs,
          status,
          totalTests,
          passedTests,
          failedTests,
          errorsBetweenTests: errors.length,
        }),
      )
      .catch((e: unknown) => log.warn('updateRun failed:', e))

    await this.store.close().catch((e: unknown) => log.warn('close failed:', e))
  }
}

/** Lazy plugin descriptor — `create(config)` exposes the FlakyTestsReporter constructor so hosts can wire it into Vitest with any IStore. */
export const vitestPlugin = definePlugin({
  name: 'plugin-vitest',
  create(_config: Config) {
    return { FlakyTestsReporter }
  },
})
