import { describe, test, expect } from 'bun:test'
import { DescribeStack } from '../src'

describe('DescribeStack.path', () => {
  test('returns bare test name when stack is empty', () => {
    const stack = new DescribeStack()
    expect(stack.path('renders')).toBe('renders')
  })

  test('joins frames with " > "', () => {
    const stack = new DescribeStack()
    stack.run('outer', () => {
      stack.run('inner', () => {
        expect(stack.path('renders')).toBe('outer > inner > renders')
      })
    })
  })
})

describe('DescribeStack.run', () => {
  test('pops frame after body returns', () => {
    const stack = new DescribeStack()
    stack.run('outer', () => {})
    expect(stack.depth).toBe(0)
    expect(stack.path('x')).toBe('x')
  })

  test('pops frame even when body throws', () => {
    const stack = new DescribeStack()
    expect(() =>
      stack.run('outer', () => {
        throw new Error('boom')
      }),
    ).toThrow('boom')
    expect(stack.depth).toBe(0)
  })

  test('propagates return value', () => {
    const stack = new DescribeStack()
    const result = stack.run('outer', () => 42)
    expect(result).toBe(42)
  })

  test('throws RangeError at max depth', () => {
    const stack = new DescribeStack()
    const recurse = (remaining: number): void => {
      if (remaining === 0) return
      stack.run(`frame-${remaining}`, () => recurse(remaining - 1))
    }
    expect(() => recurse(257)).toThrow(RangeError)
    expect(stack.depth).toBe(0)
  })
})

describe('DescribeStack.runWithFrames', () => {
  test('replaces frames absolutely and restores prior state', () => {
    const stack = new DescribeStack()
    stack.run('original', () => {
      stack.runWithFrames(['a', 'b'], () => {
        expect(stack.path('t')).toBe('a > b > t')
        expect(stack.snapshot).toEqual(['a', 'b'])
      })
      expect(stack.path('t')).toBe('original > t')
    })
  })

  test('restores prior frames even when body throws', () => {
    const stack = new DescribeStack()
    stack.run('original', () => {
      expect(() =>
        stack.runWithFrames(['a'], () => {
          throw new Error('boom')
        }),
      ).toThrow('boom')
      expect(stack.path('t')).toBe('original > t')
    })
  })

  test('throws RangeError when frames exceed max depth', () => {
    const stack = new DescribeStack()
    const tooDeep = Array.from({ length: 257 }, (_unused, index) => `f${index}`)
    expect(() => stack.runWithFrames(tooDeep, () => {})).toThrow(RangeError)
  })
})

describe('DescribeStack.snapshot', () => {
  test('returns frozen copy that cannot mutate internal state', () => {
    const stack = new DescribeStack()
    stack.run('outer', () => {
      const snap = stack.snapshot
      expect(Object.isFrozen(snap)).toBe(true)
      expect(snap).toEqual(['outer'])
    })
  })
})
