import { describe, expect, test } from 'bun:test'
import { validateTablePrefix } from './validate'

describe('validateTablePrefix()', () => {
  test('accepts lowercase letters', () => {
    expect(() => validateTablePrefix('flaky')).not.toThrow()
  })

  test('accepts underscores', () => {
    expect(() => validateTablePrefix('flaky_test')).not.toThrow()
  })

  test('accepts leading underscore', () => {
    expect(() => validateTablePrefix('_prefix')).not.toThrow()
  })

  test('accepts letters and digits', () => {
    expect(() => validateTablePrefix('test_v2')).not.toThrow()
  })

  test('rejects prefix starting with digit', () => {
    expect(() => validateTablePrefix('1test')).toThrow('invalid tablePrefix')
  })

  test('rejects uppercase letters', () => {
    expect(() => validateTablePrefix('Test')).toThrow('invalid tablePrefix')
  })

  test('rejects hyphens', () => {
    expect(() => validateTablePrefix('flaky-test')).toThrow(
      'invalid tablePrefix',
    )
  })

  test('rejects spaces', () => {
    expect(() => validateTablePrefix('flaky test')).toThrow(
      'invalid tablePrefix',
    )
  })

  test('rejects empty string', () => {
    expect(() => validateTablePrefix('')).toThrow('invalid tablePrefix')
  })

  test('rejects special characters', () => {
    expect(() => validateTablePrefix('test;drop')).toThrow(
      'invalid tablePrefix',
    )
  })
})
