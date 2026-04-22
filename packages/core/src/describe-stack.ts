const MAX_DESCRIBE_DEPTH = 256

/**
 * Tracks the current `describe` nesting so tests report their full
 * `"outer > inner > test name"` path.
 *
 * Used by the Bun preload which must monkey-patch `describe` to track nesting.
 * Vitest and other frameworks expose suite paths natively.
 */
export class DescribeStack {
  private frames: string[] = []

  /**
   * Snapshot of the current frames. Returns a frozen copy so callers cannot
   * mutate internal state.
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
        `DescribeStack exceeded maximum depth of ${MAX_DESCRIBE_DEPTH}`,
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
        `DescribeStack frames length ${frames.length} exceeds maximum depth of ${MAX_DESCRIBE_DEPTH}`,
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
