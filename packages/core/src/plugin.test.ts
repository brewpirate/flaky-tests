import { afterEach, describe, expect, test } from 'bun:test'
import type { Config } from './config'
import {
  definePlugin,
  listRegisteredPlugins,
  resetPluginRegistryForTesting,
} from './plugin'

const fakeConfig: Config = {
  log: { level: 'warn' },
  store: { type: 'sqlite' },
  detection: { windowDays: 7, threshold: 2 },
  github: {},
  plugin: { disabled: false },
  report: {},
}

afterEach(() => {
  resetPluginRegistryForTesting()
})

describe('definePlugin', () => {
  test('registers a descriptor and exposes it via listRegisteredPlugins', () => {
    const descriptor = definePlugin({
      name: 'test-plugin',
      create: () => ({ id: 42 }),
    })
    expect(listRegisteredPlugins()).toContain(descriptor)
  })

  test('rejects duplicate plugin names', () => {
    definePlugin({ name: 'dup', create: () => 1 })
    expect(() =>
      definePlugin({ name: 'dup', create: () => 2 }),
    ).toThrow(/already registered/)
  })

  test('re-registering the same descriptor object is idempotent', () => {
    const descriptor = definePlugin({ name: 'idem', create: () => 'x' })
    expect(() => definePlugin(descriptor)).not.toThrow()
  })

  test('create() receives the full config and returns the instance', () => {
    const descriptor = definePlugin({
      name: 'echo',
      create: (config: Config) => ({ windowDays: config.detection.windowDays }),
    })
    expect(descriptor.create(fakeConfig)).toEqual({ windowDays: 7 })
  })
})
