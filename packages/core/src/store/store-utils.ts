import { StoreError } from '#core/errors/errors'
import { extractMessage } from '#core/observe/categorize'

/**
 * Separator used in the timestamp-prefix trick for MAX() aggregation.
 * CHAR(1) / chr(1) is a control character that won't appear in error messages.
 */
const TIMESTAMP_SEPARATOR = '\x01'

/** A bound wrapper returned by {@link makeStoreWrapper}. */
export type StoreCallWrapper = <T>(
  method: string,
  fn: () => Promise<T>,
) => Promise<T>

/**
 * Build an adapter-scoped wrapper that turns any thrown driver error into a
 * {@link StoreError} with `package`, `method`, `message`, and `cause` set.
 *
 * Each store adapter creates one instance in its constructor
 * (`this.wrap = makeStoreWrapper('@flaky-tests/store-xxx')`) and calls
 * `this.wrap('methodName', () => driverCall())` at every public entry
 * point. Centralising the try/catch here lets the IStore contract's
 * "implementations MUST wrap driver errors in StoreError" clause be
 * satisfied identically by every backend instead of re-declared per file.
 *
 * @example
 * ```ts
 * class MyStore implements IStore {
 *   private wrap = makeStoreWrapper('@flaky-tests/store-mything')
 *   async getNewPatterns() {
 *     return this.wrap('getNewPatterns', () => this.client.query(...))
 *   }
 * }
 * ```
 */
/**
 * Re-throw unchanged when an aborted signal surfaces: the IStore contract
 * documents `AbortError` as the abort shape across every adapter, so the
 * wrapper must not hide it behind a StoreError wrapper.
 */
function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function makeStoreWrapper(packageName: string): StoreCallWrapper {
  return async <T>(method: string, fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn()
    } catch (error) {
      if (isAbortError(error)) {
        throw error
      }
      throw new StoreError({
        package: packageName,
        method,
        message: extractMessage(error),
        cause: error,
      })
    }
  }
}

/**
 * Strips the `timestamp + CHAR(1)` prefix that the MAX()-based
 * "most recent payload" trick prepends to column values.
 *
 * Works regardless of timestamp format length (SQLite ISO 24-char,
 * Postgres timestamptz::text 32-char, etc.) by searching for the
 * CHAR(1) separator dynamically.
 */
export function stripTimestampPrefix(raw: string): string {
  const separatorIndex = raw.indexOf(TIMESTAMP_SEPARATOR)
  return separatorIndex !== -1 ? raw.slice(separatorIndex + 1) : raw
}
