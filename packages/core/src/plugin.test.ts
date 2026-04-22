import { describe, expect, test } from 'bun:test'
import type { Config } from './config'
import { definePlugin, listRegisteredPlugins } from './plugin'

const fakeConfig: Config = {
  log: { level: 'warn' },
  store: { type: 'sqlite' },
  detection: { windowDays: 7, threshold: 2 },
  github: {},
  plugin: { disabled: false },
  report: {},
}

// Unique name prefixes keep these tests from colliding with real plugin
// descriptors that share the registry. The registry is process-wide module
// state — wiping it here would clear descriptors other test files rely on.
describe('definePlugin', () => {
  test('registers a descriptor and exposes it via listRegisteredPlugins', () => {
    const descriptor = definePlugin({
      name: 'test:basic-register',
      create: () => ({ id: 42 }),
    })
    expect(listRegisteredPlugins()).toContain(descriptor)
  })

  test('rejects duplicate plugin names', () => {
    definePlugin({ name: 'test:dup', create: () => 1 })
    expect(() => definePlugin({ name: 'test:dup', create: () => 2 })).toThrow(
      /already registered/,
    )
  })

  test('re-registering the same descriptor object is idempotent', () => {
    const descriptor = definePlugin({ name: 'test:idem', create: () => 'x' })
    expect(() => definePlugin(descriptor)).not.toThrow()
  })

  test('create() receives the full config and returns the instance', () => {
    const descriptor = definePlugin({
      name: 'test:echo',
      create: (config: Config) => ({ windowDays: config.detection.windowDays }),
    })
    expect(descriptor.create(fakeConfig)).toEqual({ windowDays: 7 })
  })
})
