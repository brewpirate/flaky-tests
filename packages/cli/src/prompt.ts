export { generatePrompt } from '@flaky-tests/core'

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
