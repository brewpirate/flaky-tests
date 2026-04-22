/**
 * Live end-to-end Turso integration test.
 *
 * Runs the full writer→reader pipeline against a real Turso database so
 * we catch regressions in the parts the unit-tier contract suite (which
 * uses `file::memory:`) can't exercise: the registry-based dispatcher,
 * auto-migrate on connect, plugin-registry sharing across module
 * instances, and the real libSQL HTTP path.
 *
 * How to run:
 *
 *   1. cp packages/store-turso/.env.local.example packages/store-turso/.env.local
 *   2. Fill in TURSO_LIVE_URL + TURSO_LIVE_TOKEN with a throwaway DB's creds.
 *   3. bun --env-file=packages/store-turso/.env.local \
 *          test packages/store-turso/src/live.integration.test.ts
 *
 * Without the env vars set, every test in this file skips. Safe to
 * check in — no credentials leak, and CI never accidentally runs it.
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  type Config,
  createStoreFromConfig,
  getTestCredentials,
  resolveConfig,
} from '@flaky-tests/core'
import { daysAgo, makeFailure, makeRun } from '@flaky-tests/core/test-helpers'
// Importing from './index' registers `store-turso` via definePlugin.
// Without this, the dispatcher's convention-based fallback would still
// work, but the explicit import makes the registration visible in the
// test module's import graph.
import './index'

const credentials = getTestCredentials()
const LIVE_URL = credentials.tursoLiveUrl
const LIVE_TOKEN = credentials.tursoLiveToken
const SKIP = !credentials.tursoLive || !LIVE_URL

// Unique prefix per test invocation so parallel or repeated runs don't
// collide on shared test-name space.
const RUN_PREFIX = `live-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`

function buildConfig(): Config {
  return resolveConfig({
    log: { level: 'warn' },
    store: {
      type: 'turso',
      url: LIVE_URL ?? '',
      ...(LIVE_TOKEN !== undefined && { authToken: LIVE_TOKEN }),
    },
    detection: { windowDays: 7, threshold: 2 },
    github: {},
    plugin: { disabled: false },
    report: {},
  })
}

describe.skipIf(SKIP)('TursoStore — live E2E via dispatcher', () => {
  beforeAll(() => {
    if (SKIP) return
    console.log(
      `[live-turso] running against ${LIVE_URL} with prefix ${RUN_PREFIX}`,
    )
  })

  test('resolveConfig + createStoreFromConfig + migrate on a live DB', async () => {
    const store = await createStoreFromConfig(buildConfig())
    try {
      // Migrate is idempotent; we run it twice to mirror how the CLI
      // behaves across repeat invocations against the same DB.
      await store.migrate()
      await store.migrate()
    } finally {
      await store.close()
    }
  })

  test('writer (simulated preload) → reader (simulated CLI) flow detects a newly-flaky test', async () => {
    const config = buildConfig()

    // ──── Writer side: what plugin-bun's preload would record ────
    const writer = await createStoreFromConfig(config)
    await writer.migrate()

    const testName = `${RUN_PREFIX}-flaky-login-redirect`
    const runId = `${RUN_PREFIX}-run-${crypto.randomUUID().slice(0, 8)}`

    try {
      await writer.insertRun(makeRun(runId, daysAgo(1)))
      await writer.updateRun(runId, {
        endedAt: new Date().toISOString(),
        status: 'fail',
        totalTests: 5,
        passedTests: 3,
        failedTests: 2,
      })
      await writer.insertFailures([
        makeFailure(runId, testName, daysAgo(1)),
        makeFailure(runId, testName, daysAgo(2)),
      ])
    } finally {
      await writer.close()
    }

    // ──── Reader side: what the CLI does after `resolveStore` ────
    const reader = await createStoreFromConfig(config)
    try {
      await reader.migrate()
      const patterns = await reader.getNewPatterns({
        windowDays: 7,
        threshold: 2,
      })
      const hit = patterns.find((pattern) => pattern.testName === testName)
      expect(hit).toBeDefined()
      expect(hit?.recentFails).toBe(2)
      expect(hit?.priorFails).toBe(0)
    } finally {
      await reader.close()
    }
  })

  // Cleanup: we don't drop tables (that would affect concurrent runs on
  // the same DB). The per-invocation RUN_PREFIX keeps data isolated,
  // and operators can prune old test rows with:
  //   DELETE FROM failures WHERE test_name LIKE 'live-%';
  //   DELETE FROM runs     WHERE run_id LIKE 'live-%';
  afterAll(() => {
    if (SKIP) return
    console.log(
      `[live-turso] done. Prune test rows matching prefix '${RUN_PREFIX}' if you want a clean slate.`,
    )
  })
})
