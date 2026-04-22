import { describe, expect, test } from 'bun:test'
import { ValidationError } from '@flaky-tests/core'
import { SupabaseStore } from './index'

// Unit-tier: these never reach the network — validation short-circuits in
// the constructor before createClient() is called.

describe('SupabaseStore — tablePrefix validation', () => {
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
      expect(
        () =>
          new SupabaseStore({
            url: 'https://example.supabase.co',
            key: 'anon-key',
            tablePrefix: prefix,
          }),
      ).toThrow(ValidationError)
    })
  }

  test('accepts a safe lowercase prefix', () => {
    expect(
      () =>
        new SupabaseStore({
          url: 'https://example.supabase.co',
          key: 'anon-key',
          tablePrefix: 'flaky_test',
        }),
    ).not.toThrow()
  })
})
