import { describe, expect, test } from 'bun:test'
import type { FlakyPattern } from '@flaky-tests/core'
import { generatePrompt } from './prompt'

const base: FlakyPattern = {
  testFile: 'tests/auth.test.ts',
  testName: 'auth > login > should redirect',
  recentFails: 5,
  priorFails: 0,
  failureKinds: ['timeout'],
  lastErrorMessage: 'Expected redirect within 2000ms',
  lastErrorStack: null,
  lastFailed: new Date().toISOString(),
}

describe('generatePrompt', () => {
  test('includes test name', () => {
    expect(generatePrompt(base)).toContain('auth > login > should redirect')
  })

  test('includes file path', () => {
    expect(generatePrompt(base)).toContain('tests/auth.test.ts')
  })

  test('includes failure counts and window', () => {
    const out = generatePrompt(base, 7)
    expect(out).toContain('5')
    expect(out).toContain('7 days')
  })

  test('includes failure kind', () => {
    expect(generatePrompt(base)).toContain('timeout')
  })

  test('includes last error message when present', () => {
    expect(generatePrompt(base)).toContain('Expected redirect within 2000ms')
  })

  test('omits last error section when null', () => {
    const p = { ...base, lastErrorMessage: null }
    expect(generatePrompt(p)).not.toContain('Last error')
  })

  test('includes stack trace when present', () => {
    const p = { ...base, lastErrorStack: 'Error: boom\n  at test.ts:10' }
    const out = generatePrompt(p)
    expect(out).toContain('Stack trace')
    expect(out).toContain('Error: boom')
  })

  test('trims stack trace to 20 lines and appends ellipsis', () => {
    const longStack = Array.from(
      { length: 30 },
      (_, i) => `  at frame${i}`,
    ).join('\n')
    const p = { ...base, lastErrorStack: longStack }
    const out = generatePrompt(p)
    expect(out).toContain('...')
    // Should contain frame 0-19, not frame 20+
    expect(out).toContain('at frame19')
    expect(out).not.toContain('at frame20')
  })

  test('uses custom windowDays in output', () => {
    const out = generatePrompt(base, 14)
    expect(out).toContain('14 days')
  })

  test('multiple failure kinds joined with comma', () => {
    const failureKinds: FlakyPattern['failureKinds'] = ['timeout', 'assertion']
    const p = { ...base, failureKinds }
    expect(generatePrompt(p)).toContain('timeout, assertion')
  })
})
