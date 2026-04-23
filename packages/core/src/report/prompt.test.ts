import { describe, expect, test } from 'bun:test'
import type { FlakyPattern } from '#core/types'
import { generatePrompt } from './prompt'

function makePattern(overrides: Partial<FlakyPattern> = {}): FlakyPattern {
  return {
    testFile: 'tests/auth.test.ts',
    testName: 'auth > login should redirect',
    recentFails: 3,
    priorFails: 0,
    failureKinds: ['assertion'],
    lastErrorMessage: 'Expected redirect to /dashboard',
    lastErrorStack: null,
    lastFailed: '2024-06-15T10:00:00.000Z',
    ...overrides,
  }
}

describe('generatePrompt()', () => {
  test('includes test name', () => {
    const prompt = generatePrompt(makePattern())
    expect(prompt).toContain('auth > login should redirect')
  })

  test('includes file path', () => {
    const prompt = generatePrompt(makePattern())
    expect(prompt).toContain('tests/auth.test.ts')
  })

  test('includes failure count and window', () => {
    const prompt = generatePrompt(makePattern(), 14)
    expect(prompt).toContain('3 in the last 14 days')
  })

  test('includes prior fail count', () => {
    const prompt = generatePrompt(makePattern({ priorFails: 1 }), 7)
    expect(prompt).toContain('(1 the 7 days before)')
  })

  test('includes failure kinds', () => {
    const prompt = generatePrompt(
      makePattern({ failureKinds: ['assertion', 'timeout'] }),
    )
    expect(prompt).toContain('assertion, timeout')
  })

  test('includes error message when present', () => {
    const prompt = generatePrompt(makePattern())
    expect(prompt).toContain('Expected redirect to /dashboard')
  })

  test('omits error message when null', () => {
    const prompt = generatePrompt(makePattern({ lastErrorMessage: null }))
    expect(prompt).not.toContain('Last error:')
  })

  test('includes stack trace when present', () => {
    const prompt = generatePrompt(
      makePattern({ lastErrorStack: 'Error: fail\n  at auth.test.ts:5' }),
    )
    expect(prompt).toContain('Stack trace:')
    expect(prompt).toContain('Error: fail')
  })

  test('omits stack trace when null', () => {
    const prompt = generatePrompt(makePattern({ lastErrorStack: null }))
    expect(prompt).not.toContain('Stack trace:')
  })

  test('truncates stack trace beyond 20 lines', () => {
    const longStack = Array.from(
      { length: 30 },
      (_, index) => `  at func${index}(file.ts:${index})`,
    ).join('\n')
    const prompt = generatePrompt(makePattern({ lastErrorStack: longStack }))
    expect(prompt).toContain('  ...')
    expect(prompt).toContain('at func0')
    expect(prompt).not.toContain('at func25')
  })

  test('defaults window to 7 days', () => {
    const prompt = generatePrompt(makePattern())
    expect(prompt).toContain('in the last 7 days')
  })

  test('includes investigation guidance', () => {
    const prompt = generatePrompt(makePattern())
    expect(prompt).toContain('test issue')
    expect(prompt).toContain('code issue')
  })
})
