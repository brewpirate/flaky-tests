import type { FlakyPattern } from '@flaky-tests/core'

/**
 * Generates a structured investigation prompt for a flaky test pattern.
 * Designed to be pasted directly into an AI assistant (Claude, Cursor, Copilot).
 */
export function generatePrompt(pattern: FlakyPattern, windowDays = 7): string {
  const lines: string[] = []

  lines.push(`Test \`${pattern.testName}\` has become flaky.`)
  lines.push('')
  lines.push(`File:        ${pattern.testFile}`)
  lines.push(`Failures:    ${pattern.recentFails} in the last ${windowDays} days (${pattern.priorFails} the ${windowDays} days before)`)
  lines.push(`Kind:        ${pattern.failureKinds.join(', ')}`)

  if (pattern.lastErrorMessage) {
    lines.push(`Last error:  ${pattern.lastErrorMessage}`)
  }

  lines.push('')
  lines.push('Investigate whether this is:')
  lines.push('  • A test issue  — poor setup, timing dependency, bad assertion, environment assumption')
  lines.push('  • A code issue  — regression, race condition, changed behaviour')

  if (pattern.lastErrorStack) {
    lines.push('')
    lines.push('Stack trace:')
    lines.push('```')
    // Trim to first 20 lines to keep the prompt focused
    const stackLines = pattern.lastErrorStack.split('\n').slice(0, 20)
    lines.push(stackLines.join('\n'))
    if (pattern.lastErrorStack.split('\n').length > 20) lines.push('  ...')
    lines.push('```')
  }

  return lines.join('\n')
}

/** Copy text to the system clipboard. Returns true on success, false if unavailable. */
export function copyToClipboard(text: string): boolean {
  let cmd: string[]
  if (process.platform === 'darwin') cmd = ['pbcopy']
  else if (process.platform === 'win32') cmd = ['clip']
  else cmd = ['xclip', '-selection', 'clipboard']

  try {
    const result = Bun.spawnSync({
      cmd,
      stdin: new TextEncoder().encode(text),
      stdout: 'ignore',
      stderr: 'ignore',
    })
    return result.exitCode === 0
  } catch {
    return false
  }
}
