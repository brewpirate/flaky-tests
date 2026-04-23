import { type Type, type } from 'arktype'

/** Thrown when runtime data fails ArkType schema validation. */
export class ValidationError extends Error {
  constructor(public readonly summary: string) {
    super(`[flaky-tests] Validation failed: ${summary}`)
    this.name = 'ValidationError'
  }
}

/**
 * Parse data against a schema — returns the validated value.
 *
 * @throws {@link ValidationError} when `data` fails ArkType validation; the
 *   thrown error's `summary` field contains ArkType's issue summary.
 */
export function parse<T>(schema: Type<T>, data: unknown): T {
  const result = schema(data)
  if (result instanceof type.errors) {
    throw new ValidationError(result.summary)
  }
  // ArkType's distilled output type doesn't unify with T in TS 6.0
  return result as T
}

/**
 * Parse an array of items against a schema. Used for `getNewPatterns` output.
 *
 * @throws {@link ValidationError} on the first item that fails validation.
 *   The summary is prefixed with the failing index (`[3]: ...`) so callers
 *   can locate it.
 */
export function parseArray<T>(schema: Type<T>, data: unknown[]): T[] {
  return data.map((item, index) => {
    const result = schema(item)
    if (result instanceof type.errors) {
      throw new ValidationError(`[${index}]: ${result.summary}`)
    }
    return result as T
  })
}
