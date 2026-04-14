import { describe, expect, mock, test } from 'bun:test'
import type {
  FlakyPattern,
  GetNewPatternsOptions,
  InsertFailureInput,
  InsertRunInput,
  IStore,
  UpdateRunInput,
} from '@flaky-tests/core'
import { FlakyTestsReporter } from './index'

// ---------------------------------------------------------------------------
// Mock store that records all calls
// ---------------------------------------------------------------------------

interface StoreCalls {
  insertRun: InsertRunInput[]
  updateRun: Array<{ runId: string; input: UpdateRunInput }>
  insertFailure: InsertFailureInput[]
  insertFailures: InsertFailureInput[][]
  closed: boolean
}

function createMockStore(): { store: IStore; calls: StoreCalls } {
  const calls: StoreCalls = {
    insertRun: [],
    updateRun: [],
    insertFailure: [],
    insertFailures: [],
    closed: false,
  }

  const store: IStore = {
    async migrate() {},
    async insertRun(input) {
      calls.insertRun.push(input)
    },
    async updateRun(runId, input) {
      calls.updateRun.push({ runId, input })
    },
    async insertFailure(input) {
      calls.insertFailure.push(input)
    },
    async insertFailures(inputs) {
      calls.insertFailures.push([...inputs])
    },
    async getNewPatterns(
      _options?: GetNewPatternsOptions,
    ): Promise<FlakyPattern[]> {
      return []
    },
    async close() {
      calls.closed = true
    },
  }

  return { store, calls }
}

// ---------------------------------------------------------------------------
// Task helpers (mimics Vitest task shape)
// ---------------------------------------------------------------------------

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: '1',
    name: 'test name',
    type: 'test',
    result: { state: 'pass', duration: 50 },
    file: { filepath: 'tests/example.test.ts' },
    ...overrides,
  }
}

function makeFileTask(tasks: unknown[] = []) {
  return {
    id: 'file-1',
    name: 'example.test.ts',
    type: 'suite',
    tasks,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FlakyTestsReporter', () => {
  test('onInit inserts a run record', async () => {
    const { store, calls } = createMockStore()
    const reporter = new FlakyTestsReporter(store)
    await reporter.onInit({})
    expect(calls.insertRun).toHaveLength(1)
    expect(calls.insertRun[0]?.runId).toBeString()
    expect(calls.insertRun[0]?.startedAt).toBeString()
  })

  test('onInit sets runtimeVersion to process.version', async () => {
    const { store, calls } = createMockStore()
    const reporter = new FlakyTestsReporter(store)
    await reporter.onInit({})
    expect(calls.insertRun[0]?.runtimeVersion).toBe(process.version)
  })

  test('onFinished does nothing if onInit was not called', async () => {
    const { store, calls } = createMockStore()
    const reporter = new FlakyTestsReporter(store)
    await reporter.onFinished([], [])
    expect(calls.updateRun).toHaveLength(0)
    expect(calls.closed).toBe(false)
  })

  test('onFinished with no files reports status=pass and zero counts', async () => {
    const { store, calls } = createMockStore()
    const reporter = new FlakyTestsReporter(store)
    await reporter.onInit({})
    await reporter.onFinished([], [])

    expect(calls.updateRun).toHaveLength(1)
    expect(calls.updateRun[0]?.input.status).toBe('pass')
    expect(calls.updateRun[0]?.input.totalTests).toBe(0)
    expect(calls.updateRun[0]?.input.passedTests).toBe(0)
    expect(calls.updateRun[0]?.input.failedTests).toBe(0)
  })

  test('onFinished counts passing tests', async () => {
    const { store, calls } = createMockStore()
    const reporter = new FlakyTestsReporter(store)
    await reporter.onInit({})

    const file = makeFileTask([
      makeTask({ name: 'test 1', result: { state: 'pass' } }),
      makeTask({ name: 'test 2', result: { state: 'pass' } }),
    ])
    await reporter.onFinished([file], [])

    expect(calls.updateRun[0]?.input.totalTests).toBe(2)
    expect(calls.updateRun[0]?.input.passedTests).toBe(2)
    expect(calls.updateRun[0]?.input.failedTests).toBe(0)
    expect(calls.updateRun[0]?.input.status).toBe('pass')
  })

  test('onFinished records failures and sets status=fail', async () => {
    const { store, calls } = createMockStore()
    const reporter = new FlakyTestsReporter(store)
    await reporter.onInit({})

    const error = new Error('assertion failed')
    const file = makeFileTask([
      makeTask({ name: 'passing', result: { state: 'pass' } }),
      makeTask({
        name: 'failing',
        result: { state: 'fail', errors: [error], duration: 123 },
      }),
    ])
    await reporter.onFinished([file], [])

    expect(calls.insertFailures).toHaveLength(1)
    expect(calls.insertFailures[0]).toHaveLength(1)
    expect(calls.insertFailures[0]?.[0]?.testName).toBe('failing')
    expect(calls.insertFailures[0]?.[0]?.errorMessage).toContain(
      'assertion failed',
    )
    expect(calls.updateRun[0]?.input.status).toBe('fail')
    expect(calls.updateRun[0]?.input.failedTests).toBe(1)
  })

  test('onFinished sets status=fail when errors array is non-empty', async () => {
    const { store, calls } = createMockStore()
    const reporter = new FlakyTestsReporter(store)
    await reporter.onInit({})
    await reporter.onFinished([], [new Error('uncaught')])

    expect(calls.updateRun[0]?.input.status).toBe('fail')
    expect(calls.updateRun[0]?.input.errorsBetweenTests).toBe(1)
  })

  test('onFinished builds test path from suite hierarchy', async () => {
    const { store, calls } = createMockStore()
    const reporter = new FlakyTestsReporter(store)
    await reporter.onInit({})

    const innerSuite = {
      id: 'suite-inner',
      name: 'inner',
      type: 'suite',
      tasks: [
        makeTask({
          name: 'deep test',
          result: { state: 'fail', errors: [new Error('fail')] },
        }),
      ],
    }
    // Set suite parent reference
    innerSuite.tasks[0].suite = innerSuite

    const outerSuite = {
      id: 'suite-outer',
      name: 'outer',
      type: 'suite',
      suite: undefined as unknown,
      tasks: [innerSuite],
    }
    innerSuite.suite = outerSuite

    const file = makeFileTask([outerSuite])
    await reporter.onFinished([file], [])

    expect(calls.insertFailures[0]?.[0]?.testName).toBe(
      'outer > inner > deep test',
    )
  })

  test('onFinished calls store.close()', async () => {
    const { store, calls } = createMockStore()
    const reporter = new FlakyTestsReporter(store)
    await reporter.onInit({})
    await reporter.onFinished([], [])
    expect(calls.closed).toBe(true)
  })

  test('onFinished uses consistent runId across insertRun and updateRun', async () => {
    const { store, calls } = createMockStore()
    const reporter = new FlakyTestsReporter(store)
    await reporter.onInit({})
    await reporter.onFinished([], [])

    expect(calls.insertRun[0]?.runId).toBe(calls.updateRun[0]?.runId)
  })

  test('onFinished records durationMs', async () => {
    const { store, calls } = createMockStore()
    const reporter = new FlakyTestsReporter(store)
    await reporter.onInit({})
    await reporter.onFinished([], [])

    expect(calls.updateRun[0]?.input.durationMs).toBeGreaterThanOrEqual(0)
  })

  test('onFinished skips tasks without result', async () => {
    const { store, calls } = createMockStore()
    const reporter = new FlakyTestsReporter(store)
    await reporter.onInit({})

    const file = makeFileTask([
      makeTask({ name: 'skipped', result: undefined }),
      makeTask({ name: 'passing', result: { state: 'pass' } }),
    ])
    await reporter.onFinished([file], [])

    expect(calls.updateRun[0]?.input.totalTests).toBe(1)
  })

  test('onFinished skips suite-type tasks (only counts test/custom)', async () => {
    const { store, calls } = createMockStore()
    const reporter = new FlakyTestsReporter(store)
    await reporter.onInit({})

    const file = makeFileTask([
      {
        id: 's1',
        name: 'suite',
        type: 'suite',
        result: { state: 'pass' },
        tasks: [],
      },
      makeTask({ name: 'test', result: { state: 'pass' } }),
    ])
    await reporter.onFinished([file], [])

    expect(calls.updateRun[0]?.input.totalTests).toBe(1)
  })

  test('onInit swallows store errors', async () => {
    const { store } = createMockStore()
    store.insertRun = mock(() => Promise.reject(new Error('db down')))
    const reporter = new FlakyTestsReporter(store)
    // Should not throw
    await reporter.onInit({})
  })

  test('onFinished swallows store errors', async () => {
    const { store } = createMockStore()
    store.insertFailures = mock(() => Promise.reject(new Error('db down')))
    store.updateRun = mock(() => Promise.reject(new Error('db down')))
    store.close = mock(() => Promise.reject(new Error('db down')))
    const reporter = new FlakyTestsReporter(store)
    await reporter.onInit({})
    // Should not throw
    await reporter.onFinished([], [])
  })

  test('onFinished uses file.filepath for test file path', async () => {
    const { store, calls } = createMockStore()
    const reporter = new FlakyTestsReporter(store)
    await reporter.onInit({})

    const file = makeFileTask([
      makeTask({
        name: 'failing',
        result: { state: 'fail', errors: [new Error('fail')] },
        file: { filepath: 'src/utils.test.ts' },
      }),
    ])
    await reporter.onFinished([file], [])

    expect(calls.insertFailures[0]?.[0]?.testFile).toBe('src/utils.test.ts')
  })

  test('onFinished defaults to "unknown" when file is missing', async () => {
    const { store, calls } = createMockStore()
    const reporter = new FlakyTestsReporter(store)
    await reporter.onInit({})

    const file = makeFileTask([
      makeTask({
        name: 'failing',
        result: { state: 'fail', errors: [new Error('fail')] },
        file: undefined,
      }),
    ])
    await reporter.onFinished([file], [])

    expect(calls.insertFailures[0]?.[0]?.testFile).toBe('unknown')
  })
})
