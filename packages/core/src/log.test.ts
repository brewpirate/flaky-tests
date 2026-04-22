// biome-ignore-all lint/suspicious/noConsole: this is the logger test — it must stub console

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Config, resetConfigForTesting, resolveConfig } from './config'
import { createLogger, type LogLevel, resolveLogLevel } from './log'

function baseConfig(level: LogLevel, file?: string): Config {
  return {
    log: { level, ...(file !== undefined && { file }) },
    store: { type: 'sqlite' },
    detection: { windowDays: 7, threshold: 2 },
    github: {},
    plugin: { disabled: false },
    report: {},
  }
}

function useLevel(level: LogLevel): void {
  resolveConfig(baseConfig(level))
}

function useLevelAndFile(level: LogLevel, file: string): void {
  resolveConfig(baseConfig(level, file))
}

afterEach(() => {
  resetConfigForTesting()
  mock.restore()
})

describe('resolveLogLevel', () => {
  test('defaults to warn when config parsing fails', () => {
    resetConfigForTesting()
    expect(resolveLogLevel()).toBe('warn')
  })

  test('reads each valid level from injected config', () => {
    for (const level of ['silent', 'error', 'warn', 'debug'] as const) {
      useLevel(level)
      expect(resolveLogLevel()).toBe(level)
    }
  })
})

describe('createLogger', () => {
  test('prefixes output with [flaky-tests:<namespace>]', () => {
    useLevel('debug')
    const warnSpy = mock(() => {})
    const originalWarn = console.warn
    console.warn = warnSpy
    try {
      createLogger('preload').warn('something happened')
      expect(warnSpy).toHaveBeenCalledWith(
        '[flaky-tests:preload]',
        'something happened',
      )
    } finally {
      console.warn = originalWarn
    }
  })

  test('silent level suppresses every method', () => {
    useLevel('silent')
    const spies = {
      error: mock(() => {}),
      warn: mock(() => {}),
      log: mock(() => {}),
    }
    const original = {
      error: console.error,
      warn: console.warn,
      log: console.log,
    }
    console.error = spies.error
    console.warn = spies.warn
    console.log = spies.log
    try {
      const logger = createLogger('ns')
      logger.error('err')
      logger.warn('warn')
      logger.debug('debug')
      expect(spies.error).not.toHaveBeenCalled()
      expect(spies.warn).not.toHaveBeenCalled()
      expect(spies.log).not.toHaveBeenCalled()
    } finally {
      console.error = original.error
      console.warn = original.warn
      console.log = original.log
    }
  })

  test('warn level emits warn+error, suppresses debug', () => {
    useLevel('warn')
    const spies = {
      error: mock(() => {}),
      warn: mock(() => {}),
      log: mock(() => {}),
    }
    const original = {
      error: console.error,
      warn: console.warn,
      log: console.log,
    }
    console.error = spies.error
    console.warn = spies.warn
    console.log = spies.log
    try {
      const logger = createLogger('ns')
      logger.error('err')
      logger.warn('warn')
      logger.debug('debug')
      expect(spies.error).toHaveBeenCalledTimes(1)
      expect(spies.warn).toHaveBeenCalledTimes(1)
      expect(spies.log).not.toHaveBeenCalled()
    } finally {
      console.error = original.error
      console.warn = original.warn
      console.log = original.log
    }
  })

  test('level change takes effect between calls (no re-import required)', () => {
    const warnSpy = mock(() => {})
    const originalWarn = console.warn
    console.warn = warnSpy
    try {
      const logger = createLogger('ns')
      useLevel('silent')
      logger.warn('one')
      useLevel('warn')
      logger.warn('two')
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith('[flaky-tests:ns]', 'two')
    } finally {
      console.warn = originalWarn
    }
  })
})

describe('createLogger — file sink', () => {
  let tmpDir: string
  let logPath: string

  function silenceConsole(): () => void {
    const original = {
      error: console.error,
      warn: console.warn,
      log: console.log,
    }
    console.error = mock(() => {})
    console.warn = mock(() => {})
    console.log = mock(() => {})
    return () => {
      console.error = original.error
      console.warn = original.warn
      console.log = original.log
    }
  }

  afterEach(() => {
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  test('appends each active log call to the configured file', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'flaky-log-'))
    logPath = join(tmpDir, 'flaky.log')
    useLevelAndFile('debug', logPath)
    const restore = silenceConsole()
    try {
      const logger = createLogger('preload')
      logger.error('boom')
      logger.warn('careful')
      logger.debug('trace me')
    } finally {
      restore()
    }
    const contents = readFileSync(logPath, 'utf8')
    expect(contents.split('\n').filter(Boolean)).toHaveLength(3)
    expect(contents).toContain('ERROR')
    expect(contents).toContain('WARN')
    expect(contents).toContain('DEBUG')
    expect(contents).toContain('[flaky-tests:preload]')
    expect(contents).toContain('boom')
    expect(contents).toContain('careful')
    expect(contents).toContain('trace me')
  })

  test('respects level — suppressed calls are NOT written to file', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'flaky-log-'))
    logPath = join(tmpDir, 'flaky.log')
    useLevelAndFile('warn', logPath)
    const restore = silenceConsole()
    try {
      const logger = createLogger('ns')
      logger.error('err')
      logger.warn('warn')
      logger.debug('debug')
    } finally {
      restore()
    }
    const contents = readFileSync(logPath, 'utf8')
    expect(contents).toContain('err')
    expect(contents).toContain('warn')
    expect(contents).not.toContain('debug')
  })

  test('each line is timestamped in ISO 8601', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'flaky-log-'))
    logPath = join(tmpDir, 'flaky.log')
    useLevelAndFile('warn', logPath)
    const restore = silenceConsole()
    try {
      createLogger('ns').warn('hello')
    } finally {
      restore()
    }
    const line = readFileSync(logPath, 'utf8').split('\n')[0] ?? ''
    expect(line).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z WARN {2}\[flaky-tests:ns\] hello$/,
    )
  })

  test('no file output when config.log.file is unset', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'flaky-log-'))
    logPath = join(tmpDir, 'should-not-exist.log')
    useLevel('debug') // no file
    const restore = silenceConsole()
    try {
      createLogger('ns').warn('nothing should land on disk')
    } finally {
      restore()
    }
    expect(() => readFileSync(logPath, 'utf8')).toThrow()
  })

  test('write failures are swallowed — logger never throws into the caller', () => {
    // Path inside a non-existent directory → appendFileSync throws ENOENT.
    useLevelAndFile('warn', '/nonexistent-dir/never-created/log.txt')
    const restore = silenceConsole()
    try {
      expect(() =>
        createLogger('ns').warn('still emits to console'),
      ).not.toThrow()
    } finally {
      restore()
    }
  })
})
