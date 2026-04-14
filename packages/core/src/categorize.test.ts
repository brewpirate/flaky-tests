import { describe, expect, test } from 'bun:test'
import { categorizeError, extractMessage, extractStack } from '../src'

describe('categorizeError', () => {
  test('returns unknown for non-Error values', () => {
    expect(categorizeError('string')).toBe('unknown')
    expect(categorizeError(42)).toBe('unknown')
    expect(categorizeError(null)).toBe('unknown')
    expect(categorizeError(undefined)).toBe('unknown')
    expect(categorizeError({ message: 'obj' })).toBe('unknown')
  })

  test('classifies TimeoutError by name', () => {
    const err = new Error('something')
    err.name = 'TimeoutError'
    expect(categorizeError(err)).toBe('timeout')
  })

  test('classifies timeout by message — "timed out"', () => {
    expect(categorizeError(new Error('Test timed out after 5000ms'))).toBe(
      'timeout',
    )
  })

  test('classifies timeout by message — "timeout"', () => {
    expect(categorizeError(new Error('Connection timeout'))).toBe('timeout')
  })

  test('timeout beats assertion when both signals present', () => {
    const err = new Error('timed out waiting for assertion')
    err.name = 'AssertionError'
    expect(categorizeError(err)).toBe('timeout')
  })

  test('classifies AssertionError by name', () => {
    const err = new Error('expected true to be false')
    err.name = 'AssertionError'
    expect(categorizeError(err)).toBe('assertion')
  })

  test('classifies bun expect failure by matcherResult property', () => {
    const err = Object.assign(new Error('expect failed'), { matcherResult: {} })
    expect(categorizeError(err)).toBe('assertion')
  })

  test('classifies vitest/jest expect failure by message prefix', () => {
    const err = new Error('expect(received).toBe(expected)')
    expect(categorizeError(err)).toBe('assertion')
  })

  test('returns uncaught for generic errors', () => {
    expect(categorizeError(new Error('something blew up'))).toBe('uncaught')
    expect(categorizeError(new TypeError('cannot read property'))).toBe(
      'uncaught',
    )
  })
})

describe('extractMessage', () => {
  test('returns message from Error', () => {
    expect(extractMessage(new Error('boom'))).toBe('boom')
  })

  test('coerces non-Error to string', () => {
    expect(extractMessage('raw string')).toBe('raw string')
    expect(extractMessage(42)).toBe('42')
    expect(extractMessage(null)).toBe('null')
  })
})

describe('extractStack', () => {
  test('returns stack from Error', () => {
    const err = new Error('boom')
    expect(extractStack(err)).toBeTypeOf('string')
    expect(extractStack(err)).toContain('Error: boom')
  })

  test('returns null for non-Error', () => {
    expect(extractStack('string')).toBeNull()
    expect(extractStack(42)).toBeNull()
    expect(extractStack(null)).toBeNull()
  })
})
