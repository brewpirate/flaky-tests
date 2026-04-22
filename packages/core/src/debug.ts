/**
 * Diagnostic logger for library/plugin code that must not pollute a user's
 * test output by default. Writes to stderr only when FLAKY_TESTS_DEBUG=1,
 * prefixed with `[flaky-tests]`.
 *
 * Use in non-CLI packages (plugin-bun, plugin-vitest, store-*) where
 * `console.*` would leak into the host test runner's output on every run.
 *
 * The CLI itself (packages/cli) should keep using `console.log` directly —
 * its output IS the UX.
 *
 * Uses `globalThis` to reach `process` so this module has no dependency on
 * `bun-types` / `@types/node` in downstream package tsconfigs.
 */

interface MinimalProcess {
  env: Record<string, string | undefined>
  stderr: { write(chunk: string): unknown }
}

function getProcess(): MinimalProcess | undefined {
  const p = (globalThis as { process?: MinimalProcess }).process
  return p && typeof p === 'object' ? p : undefined
}

export function debugWarn(label: string, error?: unknown): void {
  const proc = getProcess()
  if (!proc || proc.env.FLAKY_TESTS_DEBUG !== '1') return
  const prefix = `[flaky-tests] ${label}`
  if (error === undefined) {
    proc.stderr.write(`${prefix}\n`)
    return
  }
  const message = error instanceof Error ? error.message : String(error)
  proc.stderr.write(`${prefix}: ${message}\n`)
}
