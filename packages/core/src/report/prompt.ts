import { MAX_PROMPT_STACK_LINES } from '#core/config/defaults'
import type { FlakyPattern } from '#core/types'

/**
 * Generates a structured investigation prompt for a flaky test pattern.
 * Designed to be pasted directly into an AI assistant (Claude, Cursor, Copilot).
 */
export function generatePrompt(pattern: FlakyPattern, windowDays = 7): string {
  const lines: string[] = []

  lines.push(`Test \`${pattern.testName}\` has become flaky.`)
  lines.push('')
  lines.push(`File:        ${pattern.testFile}`)
  lines.push(
    `Failures:    ${pattern.recentFails} in the last ${windowDays} days (${pattern.priorFails} the ${windowDays} days before)`,
  )
  lines.push(`Kind:        ${pattern.failureKinds.join(', ')}`)

  if (pattern.lastErrorMessage) {
    lines.push(`Last error:  ${pattern.lastErrorMessage}`)
  }

  lines.push('')
  lines.push('Investigate whether this is:')
  lines.push(
    '  • A test issue  — poor setup, timing dependency, bad assertion, environment assumption',
  )
  lines.push(
    '  • A code issue  — regression, race condition, changed behaviour',
  )

  if (pattern.lastErrorStack) {
    lines.push('')
    lines.push('Stack trace:')
    lines.push('```')
    const allStackLines = pattern.lastErrorStack.split('\n')
    const stackLines = allStackLines.slice(0, MAX_PROMPT_STACK_LINES)
    lines.push(stackLines.join('\n'))
    if (allStackLines.length > MAX_PROMPT_STACK_LINES) {
      lines.push('  ...')
    }
    lines.push('```')
  }

  return lines.join('\n')
}
