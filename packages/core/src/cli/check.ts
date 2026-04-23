#!/usr/bin/env bun

/**
 * flaky-tests check
 *
 * Detects newly flaky tests by comparing failure rates across two equal time
 * windows. Exits 0 if clean, 1 if new patterns are found (CI-friendly).
 *
 * Usage:
 *   bunx @flaky-tests/core
 *   bunx @flaky-tests/core --window 14 --threshold 3
 *   bunx @flaky-tests/core --prompt     # print investigation prompts
 *   bunx @flaky-tests/core --copy       # copy first prompt to clipboard
 *   bunx @flaky-tests/core --create-issue
 *   bunx @flaky-tests/core --html       # write HTML report and open in browser
 *   bunx @flaky-tests/core --html --out report.html  # write to a specific file
 *
 * Environment variables:
 *   FLAKY_TESTS_STORE             sqlite | turso | supabase | postgres (default: sqlite)
 *   FLAKY_TESTS_DB                SQLite DB path override
 *   FLAKY_TESTS_CONNECTION_STRING DB URL for turso/supabase/postgres
 *   FLAKY_TESTS_AUTH_TOKEN        Auth token for turso/supabase
 *   FLAKY_TESTS_WINDOW            Window size in days (default: 7)
 *   FLAKY_TESTS_THRESHOLD         Min failures to flag (default: 2)
 */

// biome-ignore-all lint/suspicious/noConsole: CLI tool

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Config,
  FailureRow,
  FlakyPattern,
  IStore,
} from '@flaky-tests/core'
import {
  createLogger,
  createStoreFromConfig,
  getNewPatternsOptionsSchema,
  MAX_CLI_ERROR_MESSAGE_LENGTH,
  MissingStorePackageError,
  MS_PER_DAY,
  parse,
  resolveConfig,
} from '@flaky-tests/core'
import { aggregateDashboard, generateHtml } from '../report/html'
import { type CliConfig, parseCliConfig } from './args'
import { CliError, ConfigError } from './errors'
import {
  createIssue,
  findExistingIssue,
  gitHubConfigSchema,
  resolveRepo,
} from './github'
import { copyToClipboard, generatePrompt } from './prompt'

const log = createLogger('cli')

/** Thin pass-through to the shared dispatcher. The `import(spec)` closure
 *  is captured in THIS file so dynamic specifiers resolve against the
 *  CLI's own `node_modules` — not core's. That's what makes linked /
 *  workspace setups find adapters that core's location can't see. */
function resolveStore(config: Config): Promise<IStore> {
  log.debug(`resolveStore: type=${config.store.type}`)
  return createStoreFromConfig(config, (spec) => import(spec))
}

const VERSION = '0.1.0'

const HELP_TEXT = `flaky-tests v${VERSION}

Detect newly flaky tests by comparing failure rates across two time windows.
Exits 0 if clean, 1 if new patterns are found (CI-friendly).

Usage:
  flaky-tests [options]

Options:
  --window <days>      Lookback window in days (default: 7)
  --threshold <n>      Minimum failures to flag (default: 2)
  --prompt             Print investigation prompts for each pattern
  --copy               Copy first prompt to clipboard
  --create-issue       Open a GitHub issue for each new pattern
  --html               Write an HTML report and open in browser
  --out <path>         Output path for the HTML report (default: temp file)
  --repo <owner/repo>  Override GitHub repository (default: auto-detect)
  -h, --help           Show this help message
  -v, --version        Show version number

Environment variables:
  FLAKY_TESTS_STORE              sqlite | turso | supabase | postgres (default: sqlite)
  FLAKY_TESTS_DB                 SQLite DB path override
  FLAKY_TESTS_CONNECTION_STRING  DB URL for turso/supabase/postgres
  FLAKY_TESTS_AUTH_TOKEN         Auth token for turso/supabase
  FLAKY_TESTS_WINDOW             Window size in days (default: 7)
  FLAKY_TESTS_THRESHOLD          Min failures to flag (default: 2)
  GITHUB_TOKEN                   Required for --create-issue

Examples:
  flaky-tests                           # detect with defaults
  flaky-tests --window 14 --threshold 3 # custom detection window
  flaky-tests --prompt                  # print AI investigation prompts
  flaky-tests --create-issue            # open GitHub issues
  flaky-tests --html --out report.html  # generate HTML report`

// --- Main ----------------------------------------------------------------

/** CLI entry point: runs detection, prints a human summary, and optionally
 *  prints prompts, copies to clipboard, opens GitHub issues, or writes an
 *  HTML report. Exits 1 when patterns are found so CI can gate on it. */
async function main(
  cliConfig: CliConfig,
  runtimeConfig: Config,
): Promise<void> {
  const { windowDays, threshold, showPrompts, doCopy, doCreateIssue, doHtml } =
    cliConfig
  const store = await resolveStore(runtimeConfig)

  // Ensure the schema exists before the reader query fires. All four store
  // adapters' migrate() calls are idempotent (CREATE TABLE IF NOT EXISTS +
  // try/catch on column adds), so running this on every CLI invocation is
  // safe and covers the fresh-remote-DB case. For Supabase this verifies
  // the pre-created tables and surfaces a clean error pointing at the
  // docs when they are missing.
  try {
    await store.migrate()
  } catch (error) {
    await store.close()
    throw error
  }

  let patterns: FlakyPattern[]
  let recentRuns: Awaited<ReturnType<typeof store.getRecentRuns>> = []
  let failures: FailureRow[] = []
  try {
    patterns = await store.getNewPatterns(
      parse(getNewPatternsOptionsSchema, {
        windowDays,
        threshold,
        project: runtimeConfig.project ?? null,
      }),
    )
    // Fetch run history + raw failure rows up front so `--html` can
    // render the full dashboard even when there are zero newly-flaky
    // patterns. `listFailures` is the single primitive; aggregation
    // (kinds / hot files / per-run drill-downs) happens in core.
    if (doHtml) {
      const dashboardSince = new Date(
        Date.now() - DASHBOARD_WINDOW_DAYS * MS_PER_DAY,
      ).toISOString()
      ;[recentRuns, failures] = await Promise.all([
        store.getRecentRuns({
          limit: RECENT_RUNS_LIMIT,
          project: runtimeConfig.project ?? null,
        }),
        store.listFailures({
          since: dashboardSince,
          project: runtimeConfig.project ?? null,
        }),
      ])
    }
  } finally {
    await store.close()
  }

  if (patterns.length === 0) {
    console.log(
      `✓ No new flaky test patterns detected (window: ${windowDays}d, threshold: ${threshold})`,
    )
    if (doHtml) {
      writeAndOpenHtmlReport({
        patterns,
        windowDays,
        recentRuns,
        failures,
        outPath: cliConfig.htmlOut,
      })
    }
    process.exit(0)
  }

  const plural = patterns.length === 1 ? 'pattern' : 'patterns'
  console.log(`\n✗ ${patterns.length} new flaky test ${plural} detected\n`)

  for (const [i, p] of patterns.entries()) {
    const kindStr = p.failureKinds.join(', ')
    console.log(`  ${i + 1}. ${p.testName}`)
    console.log(
      `     ${p.testFile} · ${kindStr} · ${p.recentFails} fail${p.recentFails === 1 ? '' : 's'} in ${windowDays}d`,
    )
    if (p.lastErrorMessage) {
      const msg = p.lastErrorMessage.split('\n')[0] ?? p.lastErrorMessage
      console.log(
        `     ${msg.slice(0, MAX_CLI_ERROR_MESSAGE_LENGTH)}${msg.length > MAX_CLI_ERROR_MESSAGE_LENGTH ? '…' : ''}`,
      )
    }
    console.log()
  }

  if (showPrompts) {
    console.log('─'.repeat(60))
    for (const [i, pattern] of patterns.entries()) {
      console.log(`\n── Pattern ${i + 1} of ${patterns.length} ──\n`)
      console.log(generatePrompt(pattern, windowDays))
    }
    console.log()
  } else {
    console.log(`  Run with --prompt        to print investigation prompts`)
    console.log(
      `  Run with --copy          to copy the first prompt to clipboard`,
    )
    console.log(
      `  Run with --create-issue  to open a GitHub issue for each pattern`,
    )
    console.log()
  }

  if (doCopy && patterns[0]) {
    const prompt = generatePrompt(patterns[0], windowDays)
    const ok = copyToClipboard(prompt)
    if (ok) {
      console.log('✓ First prompt copied to clipboard\n')
    } else {
      console.log(
        '⚠ Could not copy to clipboard — print with --prompt instead\n',
      )
    }
  }

  if (doCreateIssue) {
    await openGitHubIssues(patterns, windowDays, runtimeConfig)
  }

  if (doHtml) {
    writeAndOpenHtmlReport({
      patterns,
      windowDays,
      recentRuns,
      failures,
      outPath: cliConfig.htmlOut,
    })
    // --html is an end-user report action — the HTML is the signal. Drop the
    // CI-gate exit so `bun report` doesn't look like a failure in local use.
    // Run `flaky-tests` without --html to keep the exit=1 gate for CI.
    process.exit(0)
  }

  process.exit(1)
}

/** Default limit for recent-runs queries surfaced in the HTML report. */
const RECENT_RUNS_LIMIT = 20
/** Window used for the dashboard aggregates (kinds + hot files). Intentionally
 *  wider than the detection window so the report surfaces a month of health
 *  signal even when detection only looks at the last week. */
const DASHBOARD_WINDOW_DAYS = 30
/** Max files surfaced in the "Hot files" table. */
const HOT_FILE_LIMIT = 15

interface WriteAndOpenHtmlReportOpts {
  patterns: FlakyPattern[]
  windowDays: number
  recentRuns: Awaited<ReturnType<IStore['getRecentRuns']>>
  failures: FailureRow[]
  outPath: string | undefined
}

/** Render the HTML report with whatever patterns, recent runs, and raw
 *  failure rows we have, aggregate in-process, write it to disk, and open
 *  it in the default browser. Always safe to call — empty `patterns`
 *  produces a report that still shows the run history, which is what users
 *  want after a clean run. */
function writeAndOpenHtmlReport(opts: WriteAndOpenHtmlReportOpts): void {
  const { patterns, windowDays, recentRuns, failures, outPath } = opts
  const dashboard = aggregateDashboard(failures, {
    hotFileLimit: HOT_FILE_LIMIT,
  })
  const html = generateHtml(patterns, windowDays, {
    recentRuns,
    kindBreakdown: dashboard.kindBreakdown,
    hotFiles: dashboard.hotFiles,
    failuresByRun: dashboard.failuresByRun,
  })
  const resolvedPath =
    outPath ?? join(tmpdir(), `flaky-tests-${Date.now()}.html`)
  writeFileSync(resolvedPath, html, 'utf8')
  console.log(`✓ Report written to ${resolvedPath}`)

  // Open in default browser
  let opener = 'xdg-open'
  if (process.platform === 'darwin') {
    opener = 'open'
  } else if (process.platform === 'win32') {
    opener = 'start'
  }
  Bun.spawnSync({
    cmd: [opener, resolvedPath],
    stdout: 'ignore',
    stderr: 'ignore',
  })
  console.log('  Opening in browser…\n')
}

/** Open a GitHub issue per pattern, skipping any whose title already
 *  exists so reruns do not spam. Noop-with-warning when `GITHUB_TOKEN`
 *  or the repo cannot be resolved — the CLI should keep working offline. */
async function openGitHubIssues(
  patterns: FlakyPattern[],
  windowDays: number,
  runtimeConfig: Config,
): Promise<void> {
  const token = runtimeConfig.github.token
  if (!token) {
    console.log('⚠ --create-issue requires GITHUB_TOKEN to be set\n')
    return
  }

  const repoInfo = resolveRepo(runtimeConfig)
  if (!repoInfo) {
    console.log(
      '⚠ --create-issue: could not determine owner/repo. Set GITHUB_REPOSITORY or pass --repo owner/repo\n',
    )
    return
  }

  const config = parse(gitHubConfigSchema, { token, ...repoInfo })
  console.log(`Opening issues in ${repoInfo.owner}/${repoInfo.repo}...\n`)

  for (const pattern of patterns) {
    try {
      const existing = await findExistingIssue(config, pattern.testName)
      if (existing !== null) {
        console.log(`  ↩ #${existing} already open for: ${pattern.testName}`)
        continue
      }
      const url = await createIssue(config, pattern, windowDays)
      console.log(`  ✓ Opened: ${url}`)
    } catch (error) {
      console.log(
        `  ✗ Failed for "${pattern.testName}": ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  console.log()
}

// --- Entry point ---------------------------------------------------------

try {
  const runtimeConfig = resolveConfig()
  const cliConfig = parseCliConfig({
    argv: process.argv,
    defaults: {
      windowDays: runtimeConfig.detection.windowDays,
      threshold: runtimeConfig.detection.threshold,
    },
  })

  if (cliConfig.help) {
    console.log(HELP_TEXT)
    process.exit(0)
  }
  if (cliConfig.version) {
    console.log(VERSION)
    process.exit(0)
  }

  await main(cliConfig, runtimeConfig)
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(`error: ${error.message}`)
    process.exit(2)
  }
  if (error instanceof MissingStorePackageError) {
    console.error(error.message)
    process.exit(2)
  }
  if (error instanceof CliError) {
    console.error(`error: ${error.message}`)
    process.exit(error.exitCode)
  }
  throw error
}
