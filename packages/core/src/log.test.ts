// biome-ignore-all lint/suspicious/noConsole: this is the logger test — it must stub console

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { type Config, resetConfigForTesting, resolveConfig } from './config'
import { createLogger, type LogLevel, resolveLogLevel } from './log'

function baseConfig(level: LogLevel): Config {
  return {
    log: { level },
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
