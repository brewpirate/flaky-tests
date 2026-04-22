#!/usr/bin/env bun

/**
 * flaky-tests check
 *
 * Detects newly flaky tests by comparing failure rates across two equal time
 * windows. Exits 0 if clean, 1 if new patterns are found (CI-friendly).
 *
 * Usage:
 *   bunx @flaky-tests/cli
 *   bunx @flaky-tests/cli --window 14 --threshold 3
 *   bunx @flaky-tests/cli --prompt     # print investigation prompts
 *   bunx @flaky-tests/cli --copy       # copy first prompt to clipboard
 *   bunx @flaky-tests/cli --create-issue
 *   bunx @flaky-tests/cli --html       # write HTML report and open in browser
 *   bunx @flaky-tests/cli --html --out report.html  # write to a specific file
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
import type { Config, FlakyPattern, IStore } from '@flaky-tests/core'
import {
  createLogger,
  getNewPatternsOptionsSchema,
  MAX_CLI_ERROR_MESSAGE_LENGTH,
  parse,
  resolveConfig,
} from '@flaky-tests/core'
import { type CliConfig, parseCliConfig } from './args'
import { CliError, ConfigError } from './errors'
import {
  createIssue,
  findExistingIssue,
  gitHubConfigSchema,
  resolveRepo,
} from './github'
import { generateHtml } from './html'
import { copyToClipboard, generatePrompt } from './prompt'

const log = createLogger('cli')

/** Construct the store implementation for the resolved config's store variant.
 *  Import is deferred so users pay the dependency cost only for the backend
 *  they actually use. */
async function resolveStore(config: Config): Promise<IStore> {
  const { store } = config
  log.debug(`resolveStore: type=${store.type}`)

  switch (store.type) {
    case 'turso': {
      const { TursoStore } = await import('@flaky-tests/store-turso')
      return new TursoStore({
        url: store.url,
        ...(store.authToken !== undefined && { authToken: store.authToken }),
      })
    }
    case 'supabase': {
      const { SupabaseStore } = await import('@flaky-tests/store-supabase')
      return new SupabaseStore({ url: store.url, key: store.key })
    }
    case 'postgres': {
      const { PostgresStore } = await import('@flaky-tests/store-postgres')
      return new PostgresStore(
        store.connectionString !== undefined
          ? { connectionString: store.connectionString }
          : {},
      )
    }
    case 'sqlite': {
      const { SqliteStore } = await import('@flaky-tests/store-sqlite')
      return new SqliteStore({
        ...(store.path !== undefined && { dbPath: store.path }),
      })
    }
  }
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

  let patterns: FlakyPattern[]
  try {
    patterns = await store.getNewPatterns(
      parse(getNewPatternsOptionsSchema, { windowDays, threshold }),
    )
  } finally {
    await store.close()
  }

  if (patterns.length === 0) {
    console.log(
      `✓ No new flaky test patterns detected (window: ${windowDays}d, threshold: ${threshold})`,
    )
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
    const html = generateHtml(patterns, windowDays)
    const outPath =
      cliConfig.htmlOut ?? join(tmpdir(), `flaky-tests-${Date.now()}.html`)
    writeFileSync(outPath, html, 'utf8')
    console.log(`✓ Report written to ${outPath}`)

    // Open in default browser
    let opener = 'xdg-open'
    if (process.platform === 'darwin') opener = 'open'
    else if (process.platform === 'win32') opener = 'start'
    Bun.spawnSync({
      cmd: [opener, outPath],
      stdout: 'ignore',
      stderr: 'ignore',
    })
    console.log('  Opening in browser…\n')
  }

  process.exit(1)
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
  if (error instanceof CliError) {
    console.error(`error: ${error.message}`)
    process.exit(error.exitCode)
  }
  throw error
}
