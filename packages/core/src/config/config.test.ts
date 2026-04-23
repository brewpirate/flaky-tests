import { describe, expect, test } from 'bun:test'
import { ConfigError } from '#core/errors/errors'
import { resolveConfig } from './config'

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv
}

describe('resolveConfig', () => {
  test('applies defaults when env is empty', () => {
    const config = resolveConfig(env({}))
    expect(config.log.level).toBe('warn')
    expect(config.store).toEqual({ type: 'sqlite' })
    expect(config.detection.windowDays).toBe(7)
    expect(config.detection.threshold).toBe(2)
    expect(config.plugin.disabled).toBe(false)
    expect(config.github.token).toBeUndefined()
    expect(config.report.browser).toBeUndefined()
  })

  test('maps FLAKY_TESTS_LOG to log.level (case-insensitive)', () => {
    expect(resolveConfig(env({ FLAKY_TESTS_LOG: 'DEBUG' })).log.level).toBe(
      'debug',
    )
    expect(resolveConfig(env({ FLAKY_TESTS_LOG: 'silent' })).log.level).toBe(
      'silent',
    )
  })

  test('maps sqlite store with optional path', () => {
    const config = resolveConfig(env({ FLAKY_TESTS_DB: '/tmp/x.db' }))
    expect(config.store).toEqual({ type: 'sqlite', path: '/tmp/x.db' })
  })

  test('maps turso store with required url + optional token', () => {
    const config = resolveConfig(
      env({
        FLAKY_TESTS_STORE: 'turso',
        FLAKY_TESTS_CONNECTION_STRING: 'libsql://x.turso.io',
        FLAKY_TESTS_AUTH_TOKEN: 'tok',
      }),
    )
    expect(config.store).toEqual({
      type: 'turso',
      url: 'libsql://x.turso.io',
      authToken: 'tok',
    })
  })

  test('turso store requires connection string', () => {
    expect(() => resolveConfig(env({ FLAKY_TESTS_STORE: 'turso' }))).toThrow(
      ConfigError,
    )
  })

  test('supabase store requires both url and key', () => {
    expect(() => resolveConfig(env({ FLAKY_TESTS_STORE: 'supabase' }))).toThrow(
      ConfigError,
    )
    expect(() =>
      resolveConfig(
        env({
          FLAKY_TESTS_STORE: 'supabase',
          FLAKY_TESTS_CONNECTION_STRING: 'https://x.supabase.co',
        }),
      ),
    ).toThrow(ConfigError)
  })

  test('unknown store type throws ConfigError', () => {
    expect(() => resolveConfig(env({ FLAKY_TESTS_STORE: 'dynamo' }))).toThrow(
      ConfigError,
    )
  })

  test('invalid window/threshold values throw ConfigError', () => {
    expect(() => resolveConfig(env({ FLAKY_TESTS_WINDOW: 'abc' }))).toThrow(
      ConfigError,
    )
    expect(() => resolveConfig(env({ FLAKY_TESTS_THRESHOLD: '0' }))).toThrow(
      ConfigError,
    )
    expect(() => resolveConfig(env({ FLAKY_TESTS_THRESHOLD: '1.5' }))).toThrow(
      ConfigError,
    )
  })

  test('parses FLAKY_TESTS_DISABLE as boolean', () => {
    expect(
      resolveConfig(env({ FLAKY_TESTS_DISABLE: '1' })).plugin.disabled,
    ).toBe(true)
    expect(
      resolveConfig(env({ FLAKY_TESTS_DISABLE: 'true' })).plugin.disabled,
    ).toBe(true)
    expect(
      resolveConfig(env({ FLAKY_TESTS_DISABLE: 'no' })).plugin.disabled,
    ).toBe(false)
  })

  test('folds ambient env vars into config', () => {
    const config = resolveConfig(
      env({
        GITHUB_TOKEN: 'ghp_x',
        GITHUB_REPOSITORY: 'owner/repo',
        FLAKY_TESTS_RUN_ID: 'run-abc',
        BROWSER: 'firefox',
      }),
    )
    expect(config.github).toEqual({ token: 'ghp_x', repository: 'owner/repo' })
    expect(config.plugin.runIdOverride).toBe('run-abc')
    expect(config.report.browser).toBe('firefox')
  })
})
