import { describe, test, expect } from 'bun:test'
import { captureGitInfo } from './git'

describe('captureGitInfo', () => {
  test('returns a sha and dirty flag when run inside a git repo', () => {
    const info = captureGitInfo()
    // We're running inside the flaky-tests repo, so git should be available
    expect(info.sha).toBeString()
    expect(info.sha).toHaveLength(40)
    expect(typeof info.dirty).toBe('boolean')
  })

  test('sha is a valid hex string', () => {
    const info = captureGitInfo()
    if (info.sha !== null) {
      expect(info.sha).toMatch(/^[0-9a-f]{40}$/)
    }
  })
})
