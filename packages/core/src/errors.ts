/**
 * Structured error thrown by store adapters. Captures which package
 * and method produced the error, with the original error as `cause`.
 *
 * @example
 * ```ts
 * try {
 *   await store.insertRun(input)
 * } catch (error) {
 *   if (error instanceof StoreError) {
 *     console.log(error.package)  // '@flaky-tests/store-supabase'
 *     console.log(error.method)   // 'insertRun'
 *     console.log(error.cause)    // original Supabase error
 *   }
 * }
 * ```
 */
export class StoreError extends Error {
  readonly package: string
  readonly method: string

  /**
   * Accepts an options object so callers name package/method/message at the
   * call site — prevents accidental argument reordering across adapters.
   */
  constructor(options: {
    package: string
    method: string
    message: string
    cause?: unknown
  }) {
    super(`[${options.package}] ${options.method}: ${options.message}`, {
      cause: options.cause,
    })
    this.name = 'StoreError'
    this.package = options.package
    this.method = options.method
  }
}
