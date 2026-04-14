import { describe, expect, test } from 'bun:test'
import { type } from 'arktype'
import { parse, parseArray, ValidationError } from './validate-schemas'

const stringSchema = type('string')
const numberSchema = type('number')

describe('ValidationError', () => {
  test('has name "ValidationError"', () => {
    const error = new ValidationError('bad input')
    expect(error.name).toBe('ValidationError')
  })

  test('message includes prefix and summary', () => {
    const error = new ValidationError('x must be a string')
    expect(error.message).toBe('[flaky-tests] Validation failed: x must be a string')
  })

  test('summary property is set', () => {
    const error = new ValidationError('some summary')
    expect(error.summary).toBe('some summary')
  })

  test('is instanceof Error', () => {
    const error = new ValidationError('test')
    expect(error).toBeInstanceOf(Error)
  })
})

describe('parse()', () => {
  test('returns validated value on success', () => {
    expect(parse(stringSchema, 'hello')).toBe('hello')
  })

  test('returns validated number on success', () => {
    expect(parse(numberSchema, 42)).toBe(42)
  })

  test('throws ValidationError on invalid input', () => {
    expect(() => parse(stringSchema, 123)).toThrow(ValidationError)
  })

  test('error summary describes the failure', () => {
    try {
      parse(stringSchema, 123)
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).summary).toContain('string')
    }
  })
})

describe('parseArray()', () => {
  test('returns array of validated items', () => {
    expect(parseArray(numberSchema, [1, 2, 3])).toEqual([1, 2, 3])
  })

  test('handles empty array', () => {
    expect(parseArray(stringSchema, [])).toEqual([])
  })

  test('throws ValidationError with index on failure', () => {
    try {
      parseArray(stringSchema, ['a', 'b', 123])
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError)
      expect((error as ValidationError).summary).toContain('[2]')
    }
  })

  test('fails on first invalid item', () => {
    expect(() => parseArray(numberSchema, [1, 'bad', 3])).toThrow(ValidationError)
  })
})
