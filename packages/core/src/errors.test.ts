import { describe, expect, test } from 'bun:test'
import { StoreError } from './errors'

describe('StoreError', () => {
  test('has name "StoreError"', () => {
    const error = new StoreError({ package: '@flaky-tests/store-sqlite', method: 'insertRun', message: 'fail' })
    expect(error.name).toBe('StoreError')
  })

  test('message format is [package] method: message', () => {
    const error = new StoreError({ package: '@flaky-tests/store-supabase', method: 'migrate', message: 'table not found' })
    expect(error.message).toBe('[@flaky-tests/store-supabase] migrate: table not found')
  })

  test('exposes package property', () => {
    const error = new StoreError({ package: '@flaky-tests/store-turso', method: 'close', message: 'fail' })
    expect(error.package).toBe('@flaky-tests/store-turso')
  })

  test('exposes method property', () => {
    const error = new StoreError({ package: 'pkg', method: 'insertFailure', message: 'fail' })
    expect(error.method).toBe('insertFailure')
  })

  test('sets cause when provided', () => {
    const cause = new Error('original')
    const error = new StoreError({ package: 'pkg', method: 'test', message: 'wrapped', cause })
    expect(error.cause).toBe(cause)
  })

  test('cause is undefined when not provided', () => {
    const error = new StoreError({ package: 'pkg', method: 'test', message: 'no cause' })
    expect(error.cause).toBeUndefined()
  })

  test('is instanceof Error', () => {
    const error = new StoreError({ package: 'pkg', method: 'test', message: 'fail' })
    expect(error).toBeInstanceOf(Error)
  })
})
