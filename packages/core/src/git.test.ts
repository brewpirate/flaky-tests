import { describe, expect, test } from 'bun:test'
import { captureGitInfo, type RunCommand } from './git'

describe('captureGitInfo()', () => {
  test('returns sha and dirty=false for clean repo', () => {
    const runCommand: RunCommand = (_command, args) => {
      if (args[0] === 'rev-parse') {
        return 'abc123def456abc123def456abc123def456abc1\n'
      }
      if (args[0] === 'status') {
        return ''
      }
      return null
    }
    const info = captureGitInfo(runCommand)
    expect(info.sha).toBe('abc123def456abc123def456abc123def456abc1')
    expect(info.dirty).toBe(false)
  })

  test('returns dirty=true when files are modified', () => {
    const runCommand: RunCommand = (_command, args) => {
      if (args[0] === 'rev-parse') {
        return 'abc123\n'
      }
      if (args[0] === 'status') {
        return ' M src/index.ts\n'
      }
      return null
    }
    const info = captureGitInfo(runCommand)
    expect(info.sha).toBe('abc123')
    expect(info.dirty).toBe(true)
  })

  test('returns nulls when git is unavailable', () => {
    const runCommand: RunCommand = () => null
    const info = captureGitInfo(runCommand)
    expect(info.sha).toBeNull()
    expect(info.dirty).toBeNull()
  })

  test('returns nulls when rev-parse fails but status works', () => {
    const runCommand: RunCommand = (_command, args) => {
      if (args[0] === 'rev-parse') {
        return null
      }
      if (args[0] === 'status') {
        return ''
      }
      return null
    }
    const info = captureGitInfo(runCommand)
    expect(info.sha).toBeNull()
    expect(info.dirty).toBeNull()
  })

  test('trims whitespace from sha', () => {
    const runCommand: RunCommand = (_command, args) => {
      if (args[0] === 'rev-parse') {
        return '  abc123  \n'
      }
      if (args[0] === 'status') {
        return ''
      }
      return null
    }
    expect(captureGitInfo(runCommand).sha).toBe('abc123')
  })

  test('dirty is false when porcelain output is only whitespace', () => {
    const runCommand: RunCommand = (_command, args) => {
      if (args[0] === 'rev-parse') {
        return 'abc123\n'
      }
      if (args[0] === 'status') {
        return '   \n  '
      }
      return null
    }
    expect(captureGitInfo(runCommand).dirty).toBe(false)
  })
})
