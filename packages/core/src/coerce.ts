import { FailureKindSchema, RunStatusSchema } from './schemas'
import type { FailureKind, RunStatus } from './types'

/**
 * Narrows an untrusted DB value to a `FailureKind`, defaulting to `'unknown'`
 * for anything unrecognized. Use at the DB→object boundary in IStore
 * implementations so runtime values match the declared types.
 */
export function coerceFailureKind(value: unknown): FailureKind {
  const parsed = FailureKindSchema.safeParse(value)
  return parsed.success ? parsed.data : 'unknown'
}

/**
 * Narrows an untrusted DB value to a `RunStatus | null`. Anything that is
 * not `'pass'` or `'fail'` (including empty strings and unknown variants)
 * is normalized to `null`.
 */
export function coerceRunStatus(value: unknown): RunStatus | null {
  if (value === null || value === undefined) {
    return null
  }
  const parsed = RunStatusSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Parses a comma-separated or array value of failure kinds into a
 * `FailureKind[]`, silently dropping unrecognized entries rather than
 * polluting analytics with junk.
 */
export function coerceFailureKinds(value: unknown): FailureKind[] {
  let raw: unknown[] = []
  if (Array.isArray(value)) {
    raw = value
  } else if (typeof value === 'string') {
    raw = value.split(',')
  }
  const out: FailureKind[] = []
  for (const item of raw) {
    const parsed = FailureKindSchema.safeParse(
      typeof item === 'string' ? item.trim() : item,
    )
    if (parsed.success) {
      out.push(parsed.data)
    }
  }
  return out
}
