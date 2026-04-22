import { createLogger } from './log'

const log = createLogger('retry')

/** Options accepted by {@link withRetry}. */
export interface RetryOptions {
  /** Max attempts including the first. Must be >= 1. Default 3. */
  attempts?: number
  /** Base delay in milliseconds between attempts. Default 100. */
  baseMs?: number
  /** Abort pending sleeps and reject with the signal's reason. */
  signal?: AbortSignal | undefined
  /**
   * Hook for injecting a sleep implementation. Defaults to `setTimeout`.
   * Exists so tests can run retry logic without wall-clock delays.
   */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>
  /**
   * Hook for overriding the retryable-error classifier. Defaults to
   * {@link isRetryableError}. Tests use this to force specific branches;
   * callers rarely need to touch it.
   */
  isRetryable?: (error: unknown) => boolean
}

const DEFAULT_ATTEMPTS = 3
const DEFAULT_BASE_MS = 100
const BACKOFF_MULTIPLIER = 2
const JITTER_FLOOR = 0.5
const HTTP_STATUS_SERVER_ERROR_MIN = 500
const HTTP_STATUS_SERVER_ERROR_MAX_EXCLUSIVE = 600
const HTTP_STATUS_CLIENT_ERROR_MIN = 400
const HTTP_STATUS_CLIENT_ERROR_MAX_EXCLUSIVE = 500

/** Sleep for `ms` milliseconds, rejecting if `signal` aborts before the timer fires. */
function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(signal.reason)
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(signal?.reason)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/**
 * Error-message substrings we consider transient — safe to retry because a
 * fresh connection or a moment later usually clears them. Kept as a tight
 * whitelist so we never retry logic/authorization errors by accident.
 */
const RETRYABLE_CODE_PATTERNS: readonly RegExp[] = [
  /\bECONNRESET\b/,
  /\bECONNREFUSED\b/,
  /\bETIMEDOUT\b/,
  /\bENETUNREACH\b/,
  /\bEAI_AGAIN\b/,
  /\btimed?\s*out\b/i,
  /\bfetch failed\b/i,
  /\bsocket hang up\b/i,
]

/** Dig out a numeric HTTP status from the common error shapes we see across drivers. */
function extractStatus(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const bag = error as Record<string, unknown>
  const candidates = [bag.status, bag.statusCode, bag.code]
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) {
      return candidate
    }
  }
  // supabase-js nests `{ error: { status } }`; postgres.js uses `severity` + string codes we don't retry on.
  if (typeof bag.cause === 'object' && bag.cause !== null) {
    return extractStatus(bag.cause)
  }
  return null
}

/**
 * Classifies an error as retryable. Returns `true` for:
 * - network transport failures (ECONNRESET, ECONNREFUSED, ETIMEDOUT, ENETUNREACH, EAI_AGAIN)
 * - timeout messages ("timed out", "timeout")
 * - HTTP 5xx
 *
 * Returns `false` for HTTP 4xx, validation errors, and anything we don't
 * recognize. The default is deliberately conservative — unknown errors stay
 * non-retryable so we don't mask logic bugs behind retry loops.
 */
export function isRetryableError(error: unknown): boolean {
  const status = extractStatus(error)
  if (status !== null) {
    if (
      status >= HTTP_STATUS_SERVER_ERROR_MIN &&
      status < HTTP_STATUS_SERVER_ERROR_MAX_EXCLUSIVE
    )
      return true
    if (
      status >= HTTP_STATUS_CLIENT_ERROR_MIN &&
      status < HTTP_STATUS_CLIENT_ERROR_MAX_EXCLUSIVE
    )
      return false
  }
  const message = error instanceof Error ? error.message : String(error)
  return RETRYABLE_CODE_PATTERNS.some((pattern) => pattern.test(message))
}

/**
 * Run `op` with exponential backoff on retryable failures. Retries only on
 * network/5xx errors per {@link isRetryableError}; re-throws everything else
 * immediately so logic and 4xx errors surface fast.
 *
 * Backoff schedule: `baseMs * 2^(attempt-1)` with jitter in `[0.5, 1)x` of
 * that delay. An `AbortSignal` cancels any pending sleep and rejects with
 * the signal's reason.
 *
 * On exhaustion, re-throws the last caught error so callers see the real
 * driver exception (wrapped in `StoreError` by the store adapter's own
 * `wrap` helper).
 */
export async function withRetry<T>(
  op: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = opts.attempts ?? DEFAULT_ATTEMPTS
  const baseMs = opts.baseMs ?? DEFAULT_BASE_MS
  const sleep = opts.sleep ?? defaultSleep
  const classify = opts.isRetryable ?? isRetryableError
  if (attempts < 1 || !Number.isInteger(attempts)) {
    throw new TypeError(
      `withRetry: attempts must be a positive integer, got ${attempts}`,
    )
  }
  opts.signal?.throwIfAborted()

  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await op()
    } catch (error) {
      lastError = error
      if (!classify(error)) throw error
      if (attempt === attempts) throw error
      const delay = computeBackoff(baseMs, attempt)
      log.debug(
        `retry ${attempt}/${attempts - 1} after ${delay}ms: ${error instanceof Error ? error.message : String(error)}`,
      )
      await sleep(delay, opts.signal)
    }
  }
  // Unreachable — the loop either returns or throws.
  throw lastError
}

/** Exposed for tests so they can assert the jitter bounds directly. */
export function computeBackoff(baseMs: number, attempt: number): number {
  const deterministic = baseMs * BACKOFF_MULTIPLIER ** (attempt - 1)
  const jitter = JITTER_FLOOR + Math.random() * JITTER_FLOOR
  return Math.round(deterministic * jitter)
}
