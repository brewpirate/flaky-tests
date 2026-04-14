import { describe, expect, test } from 'bun:test'
import { DescribeStack } from './describe-stack'

describe('DescribeStack', () => {
  test('starts with depth 0', () => {
    const stack = new DescribeStack()
    expect(stack.depth).toBe(0)
  })

  test('snapshot returns empty array initially', () => {
    const stack = new DescribeStack()
    expect([...stack.snapshot]).toEqual([])
  })

  test('path() returns test name when no frames', () => {
    const stack = new DescribeStack()
    expect(stack.path('my test')).toBe('my test')
  })

  test('run() pushes frame and pops after', () => {
    const stack = new DescribeStack()
    stack.run('outer', () => {
      expect(stack.depth).toBe(1)
      expect(stack.path('test')).toBe('outer > test')
    })
    expect(stack.depth).toBe(0)
  })

  test('run() returns the body result', () => {
    const stack = new DescribeStack()
    const result = stack.run('frame', () => 42)
    expect(result).toBe(42)
  })

  test('run() pops frame even if body throws', () => {
    const stack = new DescribeStack()
    try {
      stack.run('bad', () => {
        throw new Error('oops')
      })
    } catch { /* expected */ }
    expect(stack.depth).toBe(0)
  })

  test('nested run() builds full path', () => {
    const stack = new DescribeStack()
    stack.run('outer', () => {
      stack.run('inner', () => {
        expect(stack.path('test')).toBe('outer > inner > test')
        expect(stack.depth).toBe(2)
      })
    })
  })

  test('runWithFrames() replaces stack temporarily', () => {
    const stack = new DescribeStack()
    stack.runWithFrames(['X', 'Y'], () => {
      expect(stack.path('test')).toBe('X > Y > test')
      expect(stack.depth).toBe(2)
    })
    expect(stack.depth).toBe(0)
  })

  test('runWithFrames() restores original frames after', () => {
    const stack = new DescribeStack()
    stack.run('A', () => {
      stack.runWithFrames(['X', 'Y'], () => {
        expect(stack.path('test')).toBe('X > Y > test')
      })
      expect(stack.path('test')).toBe('A > test')
    })
  })

  test('runWithFrames() restores even if body throws', () => {
    const stack = new DescribeStack()
    stack.run('A', () => {
      try {
        stack.runWithFrames(['X'], () => {
          throw new Error('fail')
        })
      } catch { /* expected */ }
      expect(stack.path('test')).toBe('A > test')
    })
  })
})
