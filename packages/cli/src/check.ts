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
import type { FlakyPattern, IStore } from '@flaky-tests/core'
import { type CliConfig, parseCliConfig } from './args'
import { CliError, ConfigError } from './errors'
import { createIssue, findExistingIssue, resolveRepo } from './github'
import { generateHtml } from './html'
import { copyToClipboard, generatePrompt } from './prompt'

async function resolveStore(config: CliConfig): Promise<IStore> {
  const { storeType, connectionString, authToken, sqliteDbPath } = config
  switch (storeType) {
    case 'turso': {
      if (!connectionString) {
        throw new ConfigError(
          'FLAKY_TESTS_CONNECTION_STRING is required for store=turso',
        )
      }
      const { TursoStore } = await import('@flaky-tests/store-turso')
      return new TursoStore({
        url: connectionString,
        ...(authToken !== undefined ? { authToken } : {}),
      })
    }
    case 'supabase': {
      if (!connectionString || !authToken) {
        throw new ConfigError(
          'FLAKY_TESTS_CONNECTION_STRING and FLAKY_TESTS_AUTH_TOKEN are required for store=supabase',
        )
      }
      const { SupabaseStore } = await import('@flaky-tests/store-supabase')
      return new SupabaseStore({ url: connectionString, key: authToken })
    }
    case 'postgres': {
      const { PostgresStore } = await import('@flaky-tests/store-postgres')
      return new PostgresStore(
        connectionString !== undefined ? { connectionString } : {},
      )
    }
    case 'sqlite': {
      const { SqliteStore } = await import('@flaky-tests/store-sqlite')
      return new SqliteStore(
        sqliteDbPath !== undefined ? { dbPath: sqliteDbPath } : {},
      )
    }
    default: {
      const _exhaustive: never = storeType
      throw new ConfigError(`Unknown store type: ${String(_exhaustive)}`)
    }
  }
}

interface Snapshot {
  patterns: FlakyPattern[]
  recentRuns: Awaited<ReturnType<IStore['getRecentRuns']>>
  kindBreakdown: Awaited<ReturnType<IStore['getFailureKindBreakdown']>>
  hotFiles: Awaited<ReturnType<IStore['getHotFiles']>>
}

async function gatherSnapshot(
  store: IStore,
  config: CliConfig,
): Promise<Snapshot> {
  const { windowDays, threshold } = config
  const patterns = await store.getNewPatterns({ windowDays, threshold })
  const [recentRuns, kindBreakdown, hotFiles] = await Promise.all([
    store.getRecentRuns({ limit: 20 }),
    store.getFailureKindBreakdown({ windowDays }),
    store.getHotFiles({ windowDays, limit: 15 }),
  ])
  return { patterns, recentRuns, kindBreakdown, hotFiles }
}

function printPatterns(patterns: FlakyPattern[], windowDays: number): void {
  const plural = patterns.length === 1 ? 'pattern' : 'patterns'
  console.log(`\n✗ ${patterns.length} new flaky test ${plural} detected\n`)

  for (let index = 0; index < patterns.length; index++) {
    const pattern = patterns[index]
    if (!pattern) continue
    const kindStr = pattern.failureKinds.join(', ')
    console.log(`  ${index + 1}. ${pattern.testName}`)
    console.log(
      `     ${pattern.testFile} · ${kindStr} · ${pattern.recentFails} fail${pattern.recentFails === 1 ? '' : 's'} in ${windowDays}d`,
    )
    if (pattern.lastErrorMessage) {
      const firstLine =
        pattern.lastErrorMessage.split('\n')[0] ?? pattern.lastErrorMessage
      console.log(
        `     ${firstLine.slice(0, 120)}${firstLine.length > 120 ? '…' : ''}`,
      )
    }
    console.log()
  }
}

function printInvestigationPrompts(
  patterns: FlakyPattern[],
  windowDays: number,
): void {
  console.log('─'.repeat(60))
  for (let index = 0; index < patterns.length; index++) {
    const pattern = patterns[index]
    if (!pattern) continue
    console.log(`\n── Pattern ${index + 1} of ${patterns.length} ──\n`)
    console.log(generatePrompt(pattern, windowDays))
  }
  console.log()
}

function printUsageHints(): void {
  console.log(`  Run with --prompt        to print investigation prompts`)
  console.log(
    `  Run with --copy          to copy the first prompt to clipboard`,
  )
  console.log(
    `  Run with --create-issue  to open a GitHub issue for each pattern`,
  )
  console.log()
}

function copyFirstPromptIfRequested(
  patterns: FlakyPattern[],
  config: CliConfig,
): void {
  if (!config.doCopy) return
  const first = patterns[0]
  if (!first) return
  const ok = copyToClipboard(generatePrompt(first, config.windowDays))
  console.log(
    ok
      ? '✓ First prompt copied to clipboard\n'
      : '⚠ Could not copy to clipboard — print with --prompt instead\n',
  )
}

async function openGitHubIssues(
  patterns: FlakyPattern[],
  config: CliConfig,
): Promise<void> {
  const token = config.githubToken
  if (!token) {
    console.log('⚠ --create-issue requires GITHUB_TOKEN to be set\n')
    return
  }

  const repoInfo = resolveRepo()
  if (!repoInfo) {
    console.log(
      '⚠ --create-issue: could not determine owner/repo. Set GITHUB_REPOSITORY or pass --repo owner/repo\n',
    )
    return
  }

  const githubConfig = { token, ...repoInfo }
  console.log(`Opening issues in ${repoInfo.owner}/${repoInfo.repo}...\n`)

  for (const pattern of patterns) {
    try {
      const existing = await findExistingIssue(githubConfig, pattern.testName)
      if (existing !== null) {
        console.log(`  ↩ #${existing} already open for: ${pattern.testName}`)
        continue
      }
      const url = await createIssue(githubConfig, pattern, config.windowDays)
      console.log(`  ✓ Opened: ${url}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.log(`  ✗ Failed for "${pattern.testName}": ${message}`)
    }
  }
  console.log()
}

function writeHtmlReport(snapshot: Snapshot, config: CliConfig): void {
  const { patterns, recentRuns, kindBreakdown, hotFiles } = snapshot
  const html = generateHtml(patterns, config.windowDays, {
    recentRuns,
    kindBreakdown,
    hotFiles,
  })
  const outPath =
    config.htmlOut ?? join(tmpdir(), `flaky-tests-${Date.now()}.html`)
  writeFileSync(outPath, html, 'utf8')
  console.log(`✓ Report written to ${outPath}`)

  let opener = 'xdg-open'
  if (process.platform === 'darwin') opener = 'open'
  else if (process.platform === 'win32') opener = 'start'
  Bun.spawnSync({ cmd: [opener, outPath], stdout: 'ignore', stderr: 'ignore' })
  console.log('  Opening in browser…\n')
}

async function main(): Promise<number> {
  const config = parseCliConfig()
  const store = await resolveStore(config)

  let snapshot: Snapshot
  try {
    snapshot = await gatherSnapshot(store, config)
  } finally {
    await store.close()
  }

  const { patterns } = snapshot

  if (patterns.length === 0) {
    console.log(
      `✓ No new flaky test patterns detected (window: ${config.windowDays}d, threshold: ${config.threshold})`,
    )
    if (config.doHtml) {
      writeHtmlReport(snapshot, config)
    }
    return 0
  }

  printPatterns(patterns, config.windowDays)

  if (config.showPrompts) {
    printInvestigationPrompts(patterns, config.windowDays)
  } else {
    printUsageHints()
  }

  copyFirstPromptIfRequested(patterns, config)

  if (config.doCreateIssue) {
    await openGitHubIssues(patterns, config)
  }

  if (config.doHtml) {
    writeHtmlReport(snapshot, config)
  }

  return 1
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    if (error instanceof CliError) {
      console.error(`✗ ${error.message}`)
      process.exit(error.exitCode)
    }
    const msg =
      error instanceof Error ? (error.stack ?? error.message) : String(error)
    console.error(`✗ Unexpected error:\n${msg}`)
    process.exit(1)
  })
