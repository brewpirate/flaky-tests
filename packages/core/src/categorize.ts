import type { FailureKind } from './types'

const MAX_MESSAGE_SCAN_LENGTH = 4096
const TIMEOUT_PATTERN = /\btimed? ?out\b/i

function safeRead<T>(source: object, key: string): T | undefined {
  try {
    return (source as Record<string, unknown>)[key] as T | undefined
  } catch {
    return undefined
  }
}

/**
 * Classifies a thrown test error into a coarse category. The categories are
 * deliberately few — we want to answer "is this test timing out vs. a bad
 * assertion vs. an uncaught crash" at a glance.
 *
 * Ordering matters: a timeout thrown as an AssertionError should classify as
 * `timeout` — the timeout signal is more useful for flakiness analysis.
 *
 * Defensive against frozen objects, proxies, and pathological message lengths.
 */
export function categorizeError(error: unknown): FailureKind {
  if (!(error instanceof Error)) {
    return 'unknown'
  }

  const name = typeof error.name === 'string' ? error.name : ''
  const rawMessage = typeof error.message === 'string' ? error.message : ''
  const message =
    rawMessage.length > MAX_MESSAGE_SCAN_LENGTH
      ? rawMessage.slice(0, MAX_MESSAGE_SCAN_LENGTH)
      : rawMessage

  if (name === 'TimeoutError' || TIMEOUT_PATTERN.test(message)) {
    return 'timeout'
  }

  const hasMatcherResult = safeRead(error, 'matcherResult') !== undefined
  if (
    name === 'AssertionError' ||
    hasMatcherResult ||
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
    return typeof error.message === 'string' ? error.message : ''
  }
  try {
    return String(error)
  } catch {
    return ''
  }
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
