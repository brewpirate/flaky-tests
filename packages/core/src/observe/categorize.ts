import type { FailureKind } from '#core/types'

/** Cap on how much of `error.message` we scan — guards against regex-DoS on huge messages. */
const MAX_MESSAGE_SCAN_LENGTH = 4096

/** Word-boundary match — avoids false positives like `"documentout"`. */
const TIMEOUT_MESSAGE_PATTERN = /\btimed? ?out\b/i

/**
 * Read a property via a try/catch — a frozen object or a Proxy with a
 * throwing getter can make `in` / property access throw. Returns `undefined`
 * on failure.
 */
function safeRead(target: object, key: string): unknown {
  try {
    return (target as Record<string, unknown>)[key]
  } catch {
    return undefined
  }
}

function safeHasOwn(target: object, key: string): boolean {
  try {
    return key in target
  } catch {
    return false
  }
}

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
  const rawMessage =
    typeof safeRead(error, 'message') === 'string'
      ? (safeRead(error, 'message') as string)
      : ''
  const message = rawMessage.slice(0, MAX_MESSAGE_SCAN_LENGTH)
  const name = safeRead(error, 'name')
  if (name === 'TimeoutError' || TIMEOUT_MESSAGE_PATTERN.test(message)) {
    return 'timeout'
  }
  if (
    name === 'AssertionError' ||
    // Bun's `expect` attaches a `matcherResult` to failures
    safeHasOwn(error, 'matcherResult') ||
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
