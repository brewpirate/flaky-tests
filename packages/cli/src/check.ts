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

import type { IStore, FlakyPattern } from '@flaky-tests/core'
import { copyToClipboard, generatePrompt } from './prompt'
import { createIssue, findExistingIssue, resolveRepo } from './github'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStore } from '@flaky-tests/store-sqlite'
import type { FlakyPattern } from '@flaky-tests/core'
import { generateHtml } from './html'


async function resolveStore(): Promise<IStore> {
  const storeType = process.env.FLAKY_TESTS_STORE ?? 'sqlite'
  const connStr = process.env.FLAKY_TESTS_CONNECTION_STRING
  const authToken = process.env.FLAKY_TESTS_AUTH_TOKEN

  switch (storeType) {
    case 'turso': {
      if (!connStr) throw new Error('FLAKY_TESTS_CONNECTION_STRING is required for store=turso')
      const { TursoStore } = await import('@flaky-tests/store-turso')
      return new TursoStore({ url: connStr, authToken })
    }
    case 'supabase': {
      if (!connStr || !authToken) throw new Error('FLAKY_TESTS_CONNECTION_STRING and FLAKY_TESTS_AUTH_TOKEN are required for store=supabase')
      const { SupabaseStore } = await import('@flaky-tests/store-supabase')
      return new SupabaseStore({ url: connStr, key: authToken })
    }
    case 'postgres': {
      const { PostgresStore } = await import('@flaky-tests/store-postgres')
      return new PostgresStore({ connectionString: connStr })
    }
    default: {
      const { SqliteStore } = await import('@flaky-tests/store-sqlite')
      return new SqliteStore({ dbPath: process.env.FLAKY_TESTS_DB ?? undefined })
    }
  }
}

// --- Argument parsing (no deps, just process.argv) -----------------------

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}

function option(name: string, fallbackEnv?: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`)
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1]
  if (fallbackEnv) return process.env[fallbackEnv]
  return undefined
}

const windowDays = Number(option('window', 'FLAKY_TESTS_WINDOW') ?? 7)
const threshold = Number(option('threshold', 'FLAKY_TESTS_THRESHOLD') ?? 2)
const showPrompts = flag('prompt') || flag('copy')
const doCopy = flag('copy')
const doCreateIssue = flag('create-issue')
const doHtml = flag('html')
const htmlOut = option('out')

// --- Main ----------------------------------------------------------------

async function main(): Promise<void> {
  const store = await resolveStore()

  let patterns: FlakyPattern[]
  try {
    patterns = await store.getNewPatterns({ windowDays, threshold })
  } finally {
    await store.close()
  }

  if (patterns.length === 0) {
    console.log(`✓ No new flaky test patterns detected (window: ${windowDays}d, threshold: ${threshold})`)
    process.exit(0)
  }

  const plural = patterns.length === 1 ? 'pattern' : 'patterns'
  console.log(`\n✗ ${patterns.length} new flaky test ${plural} detected\n`)

  for (let i = 0; i < patterns.length; i++) {
    const p = patterns[i]!
    const kindStr = p.failureKinds.join(', ')
    console.log(`  ${i + 1}. ${p.testName}`)
    console.log(`     ${p.testFile} · ${kindStr} · ${p.recentFails} fail${p.recentFails === 1 ? '' : 's'} in ${windowDays}d`)
    if (p.lastErrorMessage) {
      const msg = p.lastErrorMessage.split('\n')[0] ?? p.lastErrorMessage
      console.log(`     ${msg.slice(0, 120)}${msg.length > 120 ? '…' : ''}`)
    }
    console.log()
  }

  if (showPrompts) {
    console.log('─'.repeat(60))
    for (let i = 0; i < patterns.length; i++) {
      console.log(`\n── Pattern ${i + 1} of ${patterns.length} ──\n`)
      console.log(generatePrompt(patterns[i]!, windowDays))
    }
    console.log()
  } else {
    console.log(`  Run with --prompt        to print investigation prompts`)
    console.log(`  Run with --copy          to copy the first prompt to clipboard`)
    console.log(`  Run with --create-issue  to open a GitHub issue for each pattern`)
    console.log()
  }

  if (doCopy && patterns[0]) {
    const prompt = generatePrompt(patterns[0], windowDays)
    const ok = copyToClipboard(prompt)
    if (ok) {
      console.log('✓ First prompt copied to clipboard\n')
    } else {
      console.log('⚠ Could not copy to clipboard — print with --prompt instead\n')
    }
  }

  if (doCreateIssue) {
    await openGitHubIssues(patterns, windowDays)
  if (doHtml) {
    const html = generateHtml(patterns, windowDays)
    const outPath = htmlOut ?? join(tmpdir(), `flaky-tests-${Date.now()}.html`)
    writeFileSync(outPath, html, 'utf8')
    console.log(`✓ Report written to ${outPath}`)

    // Open in default browser
    const opener =
      process.platform === 'darwin' ? 'open' :
      process.platform === 'win32'  ? 'start' :
                                      'xdg-open'
    Bun.spawnSync({ cmd: [opener, outPath], stdout: 'ignore', stderr: 'ignore' })
    console.log('  Opening in browser…\n')
  }

  process.exit(1)
}

async function openGitHubIssues(patterns: FlakyPattern[], windowDays: number): Promise<void> {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.log('⚠ --create-issue requires GITHUB_TOKEN to be set\n')
    return
  }

  const repoInfo = resolveRepo()
  if (!repoInfo) {
    console.log('⚠ --create-issue: could not determine owner/repo. Set GITHUB_REPOSITORY or pass --repo owner/repo\n')
    return
  }

  const config = { token, ...repoInfo }
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
      console.log(`  ✗ Failed for "${pattern.testName}": ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  console.log()
}

await main()
