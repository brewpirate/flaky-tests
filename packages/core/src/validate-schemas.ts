import { type, type Type } from 'arktype'

/** Thrown when runtime data fails ArkType schema validation. */
export class ValidationError extends Error {
  constructor(public readonly summary: string) {
    super(`[flaky-tests] Validation failed: ${summary}`)
    this.name = 'ValidationError'
  }
}

/** Parse data against a schema — returns the validated value or throws ValidationError. */
export function parse<T>(schema: Type<T>, data: unknown): T {
  const result = schema(data)
  if (result instanceof type.errors) {
    throw new ValidationError(result.summary)
  }
  return result
}

/** Parse an array of items against a schema. Used for getNewPatterns output. */
export function parseArray<T>(schema: Type<T>, data: unknown[]): T[] {
  return data.map((item, index) => {
    const result = schema(item)
    if (result instanceof type.errors) {
      throw new ValidationError(`[${index}]: ${result.summary}`)
    }
    return result
  })
}
