/**
 * Tracks the current `describe` nesting so tests report their full
 * `"outer > inner > test name"` path.
 *
 * Used by the Bun preload which must monkey-patch `describe` to track nesting.
 * Vitest and other frameworks expose suite paths natively.
 */
/** Guard against accidental recursion pushing frames indefinitely. */
export const MAX_DESCRIBE_DEPTH = 256

export class DescribeStack {
  private frames: string[] = []

  /**
   * Frozen snapshot of the current frames. Used by the `describe` wrapper to
   * capture the path at describe-call time (synchronous w.r.t. the outer body),
   * then replay it via `runWithFrames` whenever the runtime executes the nested
   * body. Returning a frozen copy prevents callers from mutating internal state.
   */
  get snapshot(): readonly string[] {
    return Object.freeze([...this.frames])
  }

  /**
   * Runs `body` with `name` pushed onto the stack. Pop is guaranteed by
   * try/finally so a thrown describe body does not leave a dangling frame.
   */
  run<T>(name: string, body: () => T): T {
    if (this.frames.length >= MAX_DESCRIBE_DEPTH) {
      throw new RangeError(
        `DescribeStack exceeded ${MAX_DESCRIBE_DEPTH} frames — likely accidental recursion`,
      )
    }
    this.frames.push(name)
    try {
      return body()
    } finally {
      this.frames.pop()
    }
  }

  /**
   * Runs `body` with the stack temporarily replaced by `frames` (absolute,
   * not appended). Used to restore a describe-path captured at registration
   * time, since Bun defers nested describe body execution.
   */
  runWithFrames<T>(frames: readonly string[], body: () => T): T {
    if (frames.length > MAX_DESCRIBE_DEPTH) {
      throw new RangeError(
        `DescribeStack.runWithFrames exceeded ${MAX_DESCRIBE_DEPTH} frames`,
      )
    }
    const saved = this.frames
    this.frames = [...frames]
    try {
      return body()
    } finally {
      this.frames = saved
    }
  }

  /** Returns the full path for a test, joined by ` > `. */
  path(testName: string): string {
    if (this.frames.length === 0) {
      return testName
    }
    return `${this.frames.join(' > ')} > ${testName}`
  }

  get depth(): number {
    return this.frames.length
  }
}
