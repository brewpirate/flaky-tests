import { describe, expect, test } from 'bun:test'
import { escapeHtml } from './html-utils'

describe('escapeHtml()', () => {
  test('escapes ampersand', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry')
  })

  test('escapes less-than', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;')
  })

  test('escapes greater-than', () => {
    expect(escapeHtml('a > b')).toBe('a &gt; b')
  })

  test('escapes double quotes', () => {
    expect(escapeHtml('data="value"')).toBe('data=&quot;value&quot;')
  })

  test('escapes single quotes', () => {
    expect(escapeHtml("it's")).toBe('it&#39;s')
  })

  test('handles multiple special chars in one string', () => {
    expect(escapeHtml('a&b<c>d"e\'f')).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f')
  })

  test('returns empty string unchanged', () => {
    expect(escapeHtml('')).toBe('')
  })

  test('returns plain text unchanged', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123')
  })

  test('prevents XSS injection', () => {
    const xss = '<img src=x onerror="alert(1)">'
    const escaped = escapeHtml(xss)
    expect(escaped).not.toContain('<')
    expect(escaped).not.toContain('>')
    expect(escaped).toBe('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;')
  })
})
