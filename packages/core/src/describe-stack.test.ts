import { describe, expect, test } from 'bun:test'
import { DescribeStack, MAX_DESCRIBE_DEPTH } from './describe-stack'

/** Drive the stack to the requested depth by recursively calling `run()`. */
function nestTo(stack: DescribeStack, depth: number): void {
  if (depth === 0) return
  stack.run(`d${depth}`, () => nestTo(stack, depth - 1))
}

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
    } catch {
      /* expected */
    }
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
      } catch {
        /* expected */
      }
      expect(stack.path('test')).toBe('A > test')
    })
  })

  // --- Depth-limit regression tests (issue #33) --------------------------
  // Values are hardcoded to 256 / 257 so any change to MAX_DESCRIBE_DEPTH
  // surfaces as a test failure — the guard is a behavioral contract.

  test('MAX_DESCRIBE_DEPTH is the documented 256 limit', () => {
    expect(MAX_DESCRIBE_DEPTH).toBe(256)
  })

  test('run() succeeds at 256 frames deep', () => {
    const stack = new DescribeStack()
    let observedDepth = 0
    const recurse = (depth: number): void => {
      if (depth === 0) {
        observedDepth = stack.depth
        return
      }
      stack.run(`d${depth}`, () => recurse(depth - 1))
    }
    expect(() => recurse(256)).not.toThrow()
    expect(observedDepth).toBe(256)
    expect(stack.depth).toBe(0)
  })

  test('run() throws RangeError on the 257th frame', () => {
    const stack = new DescribeStack()
    expect(() => nestTo(stack, 257)).toThrow(RangeError)
  })

  test('runWithFrames() rejects a frames array longer than 256', () => {
    const stack = new DescribeStack()
    const tooManyFrames = Array.from({ length: 257 }, (_, i) => `f${i}`)
    expect(() => stack.runWithFrames(tooManyFrames, () => undefined)).toThrow(
      RangeError,
    )
    // Exactly 256 is allowed — boundary sanity.
    const atLimit = tooManyFrames.slice(0, 256)
    expect(() => stack.runWithFrames(atLimit, () => undefined)).not.toThrow()
  })

  test('snapshot returns a frozen array that rejects mutation in strict mode', () => {
    const stack = new DescribeStack()
    stack.run('outer', () => {
      const snap = stack.snapshot
      expect(Object.isFrozen(snap)).toBe(true)
      // Test files are ESM (strict) — mutating a frozen array throws TypeError.
      expect(() => {
        ;(snap as string[]).push('leaked')
      }).toThrow(TypeError)
      // Stack state stayed clean.
      expect(stack.depth).toBe(1)
      expect([...stack.snapshot]).toEqual(['outer'])
    })
  })
})
