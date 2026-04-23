import { describe, expect, test } from 'bun:test'
import { stripTimestampPrefix } from './store-utils'

describe('stripTimestampPrefix()', () => {
  test('strips timestamp prefix before CHAR(1) separator', () => {
    const raw = '2024-06-15T10:30:00.000Z\x01Expected true to be false'
    expect(stripTimestampPrefix(raw)).toBe('Expected true to be false')
  })

  test('returns original string if no separator found', () => {
    expect(stripTimestampPrefix('no separator here')).toBe('no separator here')
  })

  test('handles empty message after separator', () => {
    expect(stripTimestampPrefix('2024-01-01T00:00:00Z\x01')).toBe('')
  })

  test('uses first separator if multiple present', () => {
    const raw = 'timestamp\x01message\x01with\x01separators'
    expect(stripTimestampPrefix(raw)).toBe('message\x01with\x01separators')
  })

  test('works with long Postgres timestamp format', () => {
    const raw = '2024-06-15 10:30:00.123456+00:00\x01error message'
    expect(stripTimestampPrefix(raw)).toBe('error message')
  })

  test('handles empty string', () => {
    expect(stripTimestampPrefix('')).toBe('')
  })
})
