import { describe, expect, test } from 'bun:test'
import { mapRowToPattern, type PatternRow } from './pattern-mapper'

function makeRow(overrides: Partial<PatternRow> = {}): PatternRow {
  return {
    test_file: 'tests/auth.test.ts',
    test_name: 'auth > login',
    recent_fails: 3,
    prior_fails: 0,
    failure_kinds: 'assertion,timeout',
    last_error_message_raw: '2024-06-15T10:00:00Z\x01Expected true to be false',
    last_error_stack_raw: '2024-06-15T10:00:00Z\x01Error: fail\n  at test.ts:5',
    last_failed: '2024-06-15T10:00:00.000Z',
    ...overrides,
  }
}

describe('mapRowToPattern()', () => {
  test('maps basic fields correctly', () => {
    const pattern = mapRowToPattern(makeRow())
    expect(pattern.testFile).toBe('tests/auth.test.ts')
    expect(pattern.testName).toBe('auth > login')
    expect(pattern.recentFails).toBe(3)
    expect(pattern.priorFails).toBe(0)
  })

  test('splits comma-separated failure_kinds string', () => {
    const pattern = mapRowToPattern(
      makeRow({ failure_kinds: 'assertion,timeout,uncaught' }),
    )
    expect(pattern.failureKinds).toEqual(['assertion', 'timeout', 'uncaught'])
  })

  test('handles failure_kinds as array (Postgres)', () => {
    const pattern = mapRowToPattern(
      makeRow({ failure_kinds: ['assertion', 'timeout'] }),
    )
    expect(pattern.failureKinds).toEqual(['assertion', 'timeout'])
  })

  test('strips timestamp prefix from error message', () => {
    const pattern = mapRowToPattern(makeRow())
    expect(pattern.lastErrorMessage).toBe('Expected true to be false')
  })

  test('strips timestamp prefix from error stack', () => {
    const pattern = mapRowToPattern(makeRow())
    expect(pattern.lastErrorStack).toBe('Error: fail\n  at test.ts:5')
  })

  test('returns null for null error message', () => {
    const pattern = mapRowToPattern(makeRow({ last_error_message_raw: null }))
    expect(pattern.lastErrorMessage).toBeNull()
  })

  test('returns null for null error stack', () => {
    const pattern = mapRowToPattern(makeRow({ last_error_stack_raw: null }))
    expect(pattern.lastErrorStack).toBeNull()
  })

  test('converts Date object to ISO string (Postgres)', () => {
    const date = new Date('2024-06-15T10:00:00.000Z')
    const pattern = mapRowToPattern(makeRow({ last_failed: date }))
    expect(pattern.lastFailed).toBe('2024-06-15T10:00:00.000Z')
  })

  test('passes string last_failed through (SQLite/Turso)', () => {
    const pattern = mapRowToPattern(
      makeRow({ last_failed: '2024-06-15T10:00:00.000Z' }),
    )
    expect(pattern.lastFailed).toBe('2024-06-15T10:00:00.000Z')
  })

  test('coerces numeric fields from strings', () => {
    const pattern = mapRowToPattern(
      makeRow({ recent_fails: '5', prior_fails: '1' }),
    )
    expect(pattern.recentFails).toBe(5)
    expect(pattern.priorFails).toBe(1)
  })
})
