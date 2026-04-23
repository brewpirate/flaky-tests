import { describe, expect, test } from 'bun:test'
import { computeBackoff, isRetryableError, withRetry } from './retry'

// A sleep stub that resolves instantly so tests don't wait on real timers.
const instantSleep = (): Promise<void> => Promise.resolve()

describe('isRetryableError', () => {
  test('ECONNRESET is retryable', () => {
    expect(isRetryableError(new Error('read ECONNRESET'))).toBe(true)
  })

  test('ECONNREFUSED is retryable', () => {
    expect(
      isRetryableError(new Error('connect ECONNREFUSED 127.0.0.1:5432')),
    ).toBe(true)
  })

  test('ETIMEDOUT is retryable', () => {
    expect(isRetryableError(new Error('operation ETIMEDOUT'))).toBe(true)
  })

  test('"timed out" message is retryable', () => {
    expect(isRetryableError(new Error('request timed out after 30s'))).toBe(
      true,
    )
  })

  test('HTTP 503 is retryable', () => {
    const error = Object.assign(new Error('service unavailable'), {
      status: 503,
    })
    expect(isRetryableError(error)).toBe(true)
  })

  test('HTTP 500 is retryable', () => {
    const error = Object.assign(new Error('internal server error'), {
      status: 500,
    })
    expect(isRetryableError(error)).toBe(true)
  })

  test('HTTP 400 is NOT retryable', () => {
    const error = Object.assign(new Error('bad request'), { status: 400 })
    expect(isRetryableError(error)).toBe(false)
  })

  test('HTTP 401 is NOT retryable', () => {
    const error = Object.assign(new Error('unauthorized'), { status: 401 })
    expect(isRetryableError(error)).toBe(false)
  })

  test('HTTP 429 is NOT retryable (caller handles rate limits explicitly)', () => {
    const error = Object.assign(new Error('too many requests'), { status: 429 })
    expect(isRetryableError(error)).toBe(false)
  })

  test('validation / assertion errors are NOT retryable', () => {
    expect(isRetryableError(new Error('invalid input: field missing'))).toBe(
      false,
    )
  })

  test('status nested under .cause is read', () => {
    const cause = Object.assign(new Error('upstream failed'), { status: 502 })
    const error = Object.assign(new Error('wrapped'), { cause })
    expect(isRetryableError(error)).toBe(true)
  })
})

describe('withRetry', () => {
  test('returns the op result on first success', async () => {
    let calls = 0
    const result = await withRetry(async () => {
      calls++
      return 'ok'
    })
    expect(result).toBe('ok')
    expect(calls).toBe(1)
  })

  test('retries on a retryable error and returns once it succeeds', async () => {
    let calls = 0
    const result = await withRetry(
      async () => {
        calls++
        if (calls < 3) {
          throw new Error('ECONNRESET')
        }
        return 'eventually'
      },
      { attempts: 5, sleep: instantSleep },
    )
    expect(result).toBe('eventually')
    expect(calls).toBe(3)
  })

  test('re-throws after exhausting attempts on persistent retryable error', async () => {
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls++
          throw new Error('ECONNRESET')
        },
        { attempts: 3, sleep: instantSleep },
      ),
    ).rejects.toThrow('ECONNRESET')
    expect(calls).toBe(3)
  })

  test('does NOT retry on non-retryable errors — fails fast', async () => {
    let calls = 0
    const error = Object.assign(new Error('bad request'), { status: 400 })
    await expect(
      withRetry(
        async () => {
          calls++
          throw error
        },
        { attempts: 5, sleep: instantSleep },
      ),
    ).rejects.toBe(error)
    expect(calls).toBe(1)
  })

  test('already-aborted signal throws before any call', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls++
          return 'never'
        },
        { signal: controller.signal, sleep: instantSleep },
      ),
    ).rejects.toThrow('cancelled')
    expect(calls).toBe(0)
  })

  test('signal abort during sleep propagates and stops retrying', async () => {
    let calls = 0
    // The real `defaultSleep` rejects with the signal's reason when aborted;
    // we model that directly here so we don't depend on wall-clock timing.
    const rejectingSleep = (): Promise<void> =>
      Promise.reject(new Error('cancelled during sleep'))
    await expect(
      withRetry(
        async () => {
          calls++
          throw new Error('ECONNRESET')
        },
        { attempts: 5, sleep: rejectingSleep },
      ),
    ).rejects.toThrow('cancelled during sleep')
    expect(calls).toBe(1)
  })

  test('attempts: 1 disables retry entirely', async () => {
    let calls = 0
    await expect(
      withRetry(
        async () => {
          calls++
          throw new Error('ECONNRESET')
        },
        { attempts: 1, sleep: instantSleep },
      ),
    ).rejects.toThrow('ECONNRESET')
    expect(calls).toBe(1)
  })

  test('rejects invalid attempts config', async () => {
    await expect(withRetry(async () => 'x', { attempts: 0 })).rejects.toThrow(
      'positive integer',
    )
    await expect(withRetry(async () => 'x', { attempts: 1.5 })).rejects.toThrow(
      'positive integer',
    )
  })

  test('custom isRetryable overrides the default classifier', async () => {
    let calls = 0
    const result = await withRetry(
      async () => {
        calls++
        if (calls < 2) {
          throw new Error('totally custom error we chose to retry')
        }
        return 'done'
      },
      { attempts: 3, sleep: instantSleep, isRetryable: () => true },
    )
    expect(result).toBe('done')
    expect(calls).toBe(2)
  })
})

describe('computeBackoff', () => {
  test('stays within the 0.5x..1x jitter window of the deterministic delay', () => {
    const base = 100
    for (let attempt = 1; attempt <= 5; attempt++) {
      const deterministic = base * 2 ** (attempt - 1)
      for (let i = 0; i < 50; i++) {
        const actual = computeBackoff(base, attempt)
        expect(actual).toBeGreaterThanOrEqual(Math.round(deterministic * 0.5))
        expect(actual).toBeLessThanOrEqual(deterministic)
      }
    }
  })
})
