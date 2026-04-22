import { describe, expect, test } from 'bun:test'
import { parseCliConfig } from './args'
import { ConfigError } from './errors'

const DEFAULTS = { windowDays: 7, threshold: 2 }

describe('parseCliConfig', () => {
  test('uses defaults when no flags are set', () => {
    const config = parseCliConfig({ argv: [], defaults: DEFAULTS })
    expect(config.windowDays).toBe(7)
    expect(config.threshold).toBe(2)
  })

  test('reads --window and --threshold flags', () => {
    const config = parseCliConfig({
      argv: ['--window', '14', '--threshold', '5'],
      defaults: DEFAULTS,
    })
    expect(config.windowDays).toBe(14)
    expect(config.threshold).toBe(5)
  })

  test('uses injected defaults when flags absent', () => {
    const config = parseCliConfig({
      argv: [],
      defaults: { windowDays: 21, threshold: 4 },
    })
    expect(config.windowDays).toBe(21)
    expect(config.threshold).toBe(4)
  })

  test('flag wins over defaults', () => {
    const config = parseCliConfig({
      argv: ['--window', '3'],
      defaults: { windowDays: 99, threshold: 2 },
    })
    expect(config.windowDays).toBe(3)
  })

  test('throws ConfigError on non-numeric --window', () => {
    expect(() =>
      parseCliConfig({ argv: ['--window', 'abc'], defaults: DEFAULTS }),
    ).toThrow(ConfigError)
  })

  test('throws ConfigError on zero or negative --window', () => {
    expect(() =>
      parseCliConfig({ argv: ['--window', '0'], defaults: DEFAULTS }),
    ).toThrow(ConfigError)
    expect(() =>
      parseCliConfig({ argv: ['--window', '-5'], defaults: DEFAULTS }),
    ).toThrow(ConfigError)
  })

  test('throws ConfigError on non-integer --threshold', () => {
    expect(() =>
      parseCliConfig({ argv: ['--threshold', '2.5'], defaults: DEFAULTS }),
    ).toThrow(ConfigError)
  })

  test('--copy implies showPrompts', () => {
    const config = parseCliConfig({ argv: ['--copy'], defaults: DEFAULTS })
    expect(config.doCopy).toBe(true)
    expect(config.showPrompts).toBe(true)
  })

  test('--prompt sets showPrompts without doCopy', () => {
    const config = parseCliConfig({ argv: ['--prompt'], defaults: DEFAULTS })
    expect(config.showPrompts).toBe(true)
    expect(config.doCopy).toBe(false)
  })

  test('recognizes --help and --version', () => {
    expect(parseCliConfig({ argv: ['--help'], defaults: DEFAULTS }).help).toBe(
      true,
    )
    expect(parseCliConfig({ argv: ['-h'], defaults: DEFAULTS }).help).toBe(true)
    expect(
      parseCliConfig({ argv: ['--version'], defaults: DEFAULTS }).version,
    ).toBe(true)
    expect(parseCliConfig({ argv: ['-v'], defaults: DEFAULTS }).version).toBe(
      true,
    )
  })

  test('captures --out and --repo when provided', () => {
    const config = parseCliConfig({
      argv: ['--html', '--out', 'report.html', '--repo', 'owner/name'],
      defaults: DEFAULTS,
    })
    expect(config.doHtml).toBe(true)
    expect(config.htmlOut).toBe('report.html')
    expect(config.repo).toBe('owner/name')
  })

  test('omits htmlOut/repo when flags absent', () => {
    const config = parseCliConfig({ argv: [], defaults: DEFAULTS })
    expect(config.htmlOut).toBeUndefined()
    expect(config.repo).toBeUndefined()
  })

  test('accepts fractional windowDays', () => {
    const config = parseCliConfig({
      argv: ['--window', '0.5'],
      defaults: DEFAULTS,
    })
    expect(config.windowDays).toBe(0.5)
  })
})

describe('CliError / ConfigError', () => {
  test('ConfigError is a named error re-exported from core', async () => {
    const { ConfigError: CE } = await import('./errors')
    const error = new CE('bad')
    expect(error.name).toBe('ConfigError')
    expect(error.message).toBe('bad')
  })
  test('CliError default exit code 1', async () => {
    const { CliError: CLI } = await import('./errors')
    expect(new CLI('oops').exitCode).toBe(1)
  })
})
