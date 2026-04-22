/**
 * Race a pending promise against an `AbortSignal` so the caller sees an
 * `AbortError` the instant the signal aborts — even when the underlying
 * driver cannot cancel the in-flight request. The original promise is not
 * cancelled for drivers without native signal support (libsql/sqlite); it
 * resolves in the background, but its result is discarded.
 *
 * When `signal` is `undefined`, the promise is returned unchanged (no
 * overhead for the common case).
 */
export function raceAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<T> {
  if (signal === undefined) {
    return promise
  }
  signal.throwIfAborted()
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(signal.reason)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}
