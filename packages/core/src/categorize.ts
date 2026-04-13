import type { FailureKind } from './types'

/**
 * Classifies a thrown test error into a coarse category. The categories are
 * deliberately few — we want to answer "is this test timing out vs. a bad
 * assertion vs. an uncaught crash" at a glance.
 *
 * Ordering matters: a timeout thrown as an AssertionError should classify as
 * `timeout` — the timeout signal is more useful for flakiness analysis.
 */
export function categorizeError(error: unknown): FailureKind {
  if (!(error instanceof Error)) {
    return 'unknown'
  }
  const message = error.message ?? ''
  if (error.name === 'TimeoutError' || /timed? ?out/i.test(message)) {
    return 'timeout'
  }
  if (
    error.name === 'AssertionError' ||
    // Bun's `expect` attaches a `matcherResult` to failures
    'matcherResult' in error ||
    // Vitest / Jest expect error format
    message.startsWith('expect(received)')
  ) {
    return 'assertion'
  }
  return 'uncaught'
}

/**
 * Extracts a message string from a thrown value, coercing non-Error throws
 * to their string representation.
 */
export function extractMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

/**
 * Extracts a stack string from a thrown value. Returns `null` for non-Error
 * throws that have no stack.
 */
export function extractStack(error: unknown): string | null {
  if (error instanceof Error && typeof error.stack === 'string') {
    return error.stack
  }
  return null
}
