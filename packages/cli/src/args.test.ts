import { describe, expect, test } from 'bun:test'
import { parseCliConfig } from './args'
import { ConfigError } from './errors'

const EMPTY_ENV: Record<string, string | undefined> = {}

describe('parseCliConfig', () => {
  test('defaults windowDays=7, threshold=2 when neither flag nor env set', () => {
    const config = parseCliConfig({ argv: [], env: EMPTY_ENV })
    expect(config.windowDays).toBe(7)
    expect(config.threshold).toBe(2)
  })

  test('reads --window and --threshold flags', () => {
    const config = parseCliConfig({
      argv: ['--window', '14', '--threshold', '5'],
      env: EMPTY_ENV,
    })
    expect(config.windowDays).toBe(14)
    expect(config.threshold).toBe(5)
  })

  test('reads window/threshold from env when flags absent', () => {
    const config = parseCliConfig({
      argv: [],
      env: { FLAKY_TESTS_WINDOW: '21', FLAKY_TESTS_THRESHOLD: '4' },
    })
    expect(config.windowDays).toBe(21)
    expect(config.threshold).toBe(4)
  })

  test('flag wins over env', () => {
    const config = parseCliConfig({
      argv: ['--window', '3'],
      env: { FLAKY_TESTS_WINDOW: '99' },
    })
    expect(config.windowDays).toBe(3)
  })

  test('throws ConfigError on non-numeric --window', () => {
    expect(() =>
      parseCliConfig({ argv: ['--window', 'abc'], env: EMPTY_ENV }),
    ).toThrow(ConfigError)
  })

  test('throws ConfigError on zero or negative --window', () => {
    expect(() =>
      parseCliConfig({ argv: ['--window', '0'], env: EMPTY_ENV }),
    ).toThrow(ConfigError)
    expect(() =>
      parseCliConfig({ argv: ['--window', '-5'], env: EMPTY_ENV }),
    ).toThrow(ConfigError)
  })

  test('throws ConfigError on non-integer --threshold', () => {
    expect(() =>
      parseCliConfig({ argv: ['--threshold', '2.5'], env: EMPTY_ENV }),
    ).toThrow(ConfigError)
  })

  test('--copy implies showPrompts', () => {
    const config = parseCliConfig({ argv: ['--copy'], env: EMPTY_ENV })
    expect(config.doCopy).toBe(true)
    expect(config.showPrompts).toBe(true)
  })

  test('--prompt sets showPrompts without doCopy', () => {
    const config = parseCliConfig({ argv: ['--prompt'], env: EMPTY_ENV })
    expect(config.showPrompts).toBe(true)
    expect(config.doCopy).toBe(false)
  })

  test('recognizes --help and --version', () => {
    expect(parseCliConfig({ argv: ['--help'], env: EMPTY_ENV }).help).toBe(true)
    expect(parseCliConfig({ argv: ['-h'], env: EMPTY_ENV }).help).toBe(true)
    expect(
      parseCliConfig({ argv: ['--version'], env: EMPTY_ENV }).version,
    ).toBe(true)
    expect(parseCliConfig({ argv: ['-v'], env: EMPTY_ENV }).version).toBe(true)
  })

  test('captures --out and --repo when provided', () => {
    const config = parseCliConfig({
      argv: ['--html', '--out', 'report.html', '--repo', 'owner/name'],
      env: EMPTY_ENV,
    })
    expect(config.doHtml).toBe(true)
    expect(config.htmlOut).toBe('report.html')
    expect(config.repo).toBe('owner/name')
  })

  test('omits htmlOut/repo when flags absent', () => {
    const config = parseCliConfig({ argv: [], env: EMPTY_ENV })
    expect(config.htmlOut).toBeUndefined()
    expect(config.repo).toBeUndefined()
  })

  test('accepts fractional windowDays', () => {
    const config = parseCliConfig({
      argv: ['--window', '0.5'],
      env: EMPTY_ENV,
    })
    expect(config.windowDays).toBe(0.5)
  })
})

describe('CliError / ConfigError', () => {
  test('ConfigError has exit code 2', async () => {
    const { ConfigError: CE } = await import('./errors')
    expect(new CE('bad').exitCode).toBe(2)
  })
  test('CliError default exit code 1', async () => {
    const { CliError: CLI } = await import('./errors')
    expect(new CLI('oops').exitCode).toBe(1)
  })
})
