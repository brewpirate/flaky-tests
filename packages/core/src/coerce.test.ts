import { describe, expect, test } from 'bun:test'
import { coerceFailureKind, coerceFailureKinds, coerceRunStatus } from '../src'

describe('coerceFailureKind', () => {
  test('accepts known kinds', () => {
    expect(coerceFailureKind('assertion')).toBe('assertion')
    expect(coerceFailureKind('timeout')).toBe('timeout')
  })

  test('falls back to unknown for junk', () => {
    expect(coerceFailureKind('nope')).toBe('unknown')
    expect(coerceFailureKind(null)).toBe('unknown')
    expect(coerceFailureKind(undefined)).toBe('unknown')
    expect(coerceFailureKind(42)).toBe('unknown')
    expect(coerceFailureKind({})).toBe('unknown')
  })
})

describe('coerceRunStatus', () => {
  test('accepts pass and fail', () => {
    expect(coerceRunStatus('pass')).toBe('pass')
    expect(coerceRunStatus('fail')).toBe('fail')
  })

  test('returns null for null/undefined', () => {
    expect(coerceRunStatus(null)).toBeNull()
    expect(coerceRunStatus(undefined)).toBeNull()
  })

  test('returns null for unknown strings and other types', () => {
    expect(coerceRunStatus('')).toBeNull()
    expect(coerceRunStatus('PASS')).toBeNull()
    expect(coerceRunStatus('error')).toBeNull()
    expect(coerceRunStatus(1)).toBeNull()
  })
})

describe('coerceFailureKinds', () => {
  test('parses comma-separated string, trimming whitespace', () => {
    expect(coerceFailureKinds('assertion, timeout ,unknown')).toEqual([
      'assertion',
      'timeout',
      'unknown',
    ])
  })

  test('accepts array form and drops unrecognized entries', () => {
    expect(coerceFailureKinds(['assertion', 'garbage', 'timeout'])).toEqual([
      'assertion',
      'timeout',
    ])
  })

  test('drops non-string array entries', () => {
    expect(coerceFailureKinds(['assertion', 42, null, 'timeout'])).toEqual([
      'assertion',
      'timeout',
    ])
  })

  test('returns empty array for unsupported inputs', () => {
    expect(coerceFailureKinds(null)).toEqual([])
    expect(coerceFailureKinds(undefined)).toEqual([])
    expect(coerceFailureKinds(42)).toEqual([])
    expect(coerceFailureKinds({})).toEqual([])
  })

  test('returns empty array for empty string', () => {
    expect(coerceFailureKinds('')).toEqual([])
  })
})
