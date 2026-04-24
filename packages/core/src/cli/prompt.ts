import { spawnSync } from 'node:child_process'

export { generatePrompt } from '#core'

/** Copy text to the system clipboard. Returns true on success, false if unavailable. */
export function copyToClipboard(text: string): boolean {
  let command: string
  let args: string[]
  if (process.platform === 'darwin') {
    command = 'pbcopy'
    args = []
  } else if (process.platform === 'win32') {
    command = 'clip'
    args = []
  } else {
    command = 'xclip'
    args = ['-selection', 'clipboard']
  }

  try {
    const result = spawnSync(command, args, {
      input: text,
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    return result.status === 0
  } catch {
    return false
  }
}
