// biome-ignore-all lint/suspicious/noConsole: this is the logger test — it must stub console

import { afterEach, describe, expect, mock, test } from 'bun:test'
import { createLogger, resolveLogLevel } from './log'

const originalEnv = process.env.FLAKY_TESTS_LOG

afterEach(() => {
  if (originalEnv === undefined) {
    delete process.env.FLAKY_TESTS_LOG
  } else {
    process.env.FLAKY_TESTS_LOG = originalEnv
  }
  mock.restore()
})

describe('resolveLogLevel', () => {
  test('defaults to warn when env is unset', () => {
    delete process.env.FLAKY_TESTS_LOG
    expect(resolveLogLevel()).toBe('warn')
  })

  test('reads each valid level from env', () => {
    for (const level of ['silent', 'error', 'warn', 'debug'] as const) {
      process.env.FLAKY_TESTS_LOG = level
      expect(resolveLogLevel()).toBe(level)
    }
  })

  test('is case-insensitive', () => {
    process.env.FLAKY_TESTS_LOG = 'DEBUG'
    expect(resolveLogLevel()).toBe('debug')
  })

  test('falls back to warn on garbage value', () => {
    process.env.FLAKY_TESTS_LOG = 'loud'
    expect(resolveLogLevel()).toBe('warn')
  })
})

describe('createLogger', () => {
  test('prefixes output with [flaky-tests:<namespace>]', () => {
    process.env.FLAKY_TESTS_LOG = 'debug'
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
    process.env.FLAKY_TESTS_LOG = 'silent'
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
    process.env.FLAKY_TESTS_LOG = 'warn'
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
      process.env.FLAKY_TESTS_LOG = 'silent'
      logger.warn('one')
      process.env.FLAKY_TESTS_LOG = 'warn'
      logger.warn('two')
      expect(warnSpy).toHaveBeenCalledTimes(1)
      expect(warnSpy).toHaveBeenCalledWith('[flaky-tests:ns]', 'two')
    } finally {
      console.warn = originalWarn
    }
  })
})
