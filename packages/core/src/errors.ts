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
/** Thrown by `resolveConfig()` and `parseCliConfig()` when input validation fails. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

/**
 * Thrown by `createStoreFromConfig` when the adapter package for the
 * configured store type isn't installed. The message names both the
 * store type and the exact install command so callers don't have to
 * cross-reference docs.
 */
export class MissingStorePackageError extends Error {
  readonly storeType: string
  readonly packageName: string
  constructor(storeType: string, packageName: string) {
    super(
      `flaky-tests: configured store type "${storeType}" requires the ` +
        `"${packageName}" package, which is not installed. ` +
        `Install it with:  bun add ${packageName}  — or change ` +
        `FLAKY_TESTS_STORE to a type whose package is installed.`,
    )
    this.name = 'MissingStorePackageError'
    this.storeType = storeType
    this.packageName = packageName
  }
}

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
