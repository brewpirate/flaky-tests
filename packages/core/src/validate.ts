import type { z } from 'zod'
import { ValidationError } from './types'

/**
 * Run a zod schema against an untrusted input. On success returns the parsed
 * value (narrowed to the schema's inferred type). On failure throws
 * `ValidationError` with a flattened message like
 * `"insertRun: runId: must be at most 128 characters; startedAt: required"`.
 *
 * Use at `IStore` method boundaries so bad data is rejected before reaching
 * the backend, per the IStore contract.
 */
export function validateInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
  label: string,
): T {
  const result = schema.safeParse(input)
  if (result.success) return result.data
  const issues = result.error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '<root>'
      return `${path}: ${issue.message}`
    })
    .join('; ')
  throw new ValidationError(`${label}: ${issues}`, { cause: result.error })
}
