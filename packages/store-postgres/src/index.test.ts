import { describe, expect, test } from 'bun:test'
import { StoreError, ValidationError } from '@flaky-tests/core'
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

describe('PostgresStore — wraps driver errors in StoreError', () => {
  test('operations on a closed pool throw StoreError, not the raw postgres error', async () => {
    // Connection string targets a port where nothing listens; we never even
    // reach the first query because close() runs first, turning the pool
    // into a terminal state. The subsequent insertRun then surfaces that
    // terminal error through our wrap().
    const store = new PostgresStore({
      connectionString: 'postgres://user:pass@127.0.0.1:1/nonexistent',
    })
    await store.close()

    try {
      await store.insertRun({
        runId: 'r1',
        startedAt: new Date().toISOString(),
      })
      throw new Error('expected insertRun to reject')
    } catch (error) {
      expect(error).toBeInstanceOf(StoreError)
      expect((error as StoreError).package).toBe('@flaky-tests/store-postgres')
      expect((error as StoreError).method).toBe('insertRun')
      expect((error as StoreError).cause).toBeDefined()
    }
  })
})
