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
 *   bunx @flaky-tests/cli --html       # write HTML report and open in browser
 *   bunx @flaky-tests/cli --html --out report.html  # write to a specific file
 *
 * Environment variables:
 *   FLAKY_TESTS_DB         Override SQLite DB path
 *   FLAKY_TESTS_WINDOW     Window size in days (default: 7)
 *   FLAKY_TESTS_THRESHOLD  Min failures to flag (default: 2)
 */

// biome-ignore-all lint/suspicious/noConsole: CLI tool

import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SqliteStore } from '@flaky-tests/store-sqlite'
import type { FlakyPattern } from '@flaky-tests/core'
import { copyToClipboard, generatePrompt } from './prompt'
import { generateHtml } from './html'

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
const doHtml = flag('html')
const htmlOut = option('out')

// --- Main ----------------------------------------------------------------

async function main(): Promise<void> {
  const store = new SqliteStore({
    dbPath: process.env.FLAKY_TESTS_DB ?? undefined,
  })

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
    console.log(`  Run with --prompt to print investigation prompts`)
    console.log(`  Run with --copy   to copy the first prompt to clipboard`)
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

await main()
