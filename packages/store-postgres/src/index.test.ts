import { describe, expect, test } from 'bun:test'
import { ValidationError } from '@flaky-tests/core'
import { PostgresStore } from './index'

// Unit-tier: these never reach the DB — validation short-circuits in the
// constructor before postgres() is called.

describe('PostgresStore — tablePrefix validation', () => {
  const malicious = [
    '"; DROP TABLE --',
    "'; DROP TABLE users; --",
    'runs; DELETE FROM runs',
    'runs"/*',
    'runs OR 1=1',
    'runs-with-hyphen',
    'runs.with.dots',
    '1_starts_with_digit',
    '',
  ] as const

  for (const prefix of malicious) {
    test(`rejects malicious tablePrefix: ${JSON.stringify(prefix)}`, () => {
      expect(() => new PostgresStore({ tablePrefix: prefix })).toThrow(
        ValidationError,
      )
    })
  }

  test('accepts a safe lowercase prefix', () => {
    // We don't need a live connection for the constructor to succeed — the
    // `postgres` client is built lazily. Just assert no throw.
    expect(
      () =>
        new PostgresStore({
          connectionString: 'postgres://localhost:5432/nope',
          tablePrefix: 'flaky_test',
        }),
    ).not.toThrow()
  })
})
