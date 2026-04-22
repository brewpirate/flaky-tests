/**
 * Generates a self-contained HTML report from the flaky-tests SQLite DB.
 *
 * Usage:
 *   bun packages/store-sqlite/src/report.ts
 *   FLAKY_TESTS_DB=<path> bun packages/store-sqlite/src/report.ts
 *   bun packages/store-sqlite/src/report.ts --out <path>
 *   bun packages/store-sqlite/src/report.ts --open
 */

// biome-ignore-all lint/suspicious/noConsole: CLI script

import { Database } from 'bun:sqlite'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  escapeHtml,
  type FlakyPattern,
  generatePrompt,
  MAX_FAILED_TESTS_PER_RUN,
  stripTimestampPrefix,
} from '@flaky-tests/core'

const DB_PATH =
  process.env.FLAKY_TESTS_DB ?? 'node_modules/.cache/flaky-tests/failures.db'
const DEFAULT_OUT_PATH = 'test-report.html'
const outFlagIndex = process.argv.indexOf('--out')
const OUT_PATH =
  outFlagIndex !== -1 && outFlagIndex + 1 < process.argv.length
    ? (process.argv[outFlagIndex + 1] ?? DEFAULT_OUT_PATH)
    : DEFAULT_OUT_PATH

interface FlakyRow {
  test_file: string
  test_name: string
  fails: number
  last_failed: string
  kinds: string
  error_message_raw: string | null
  error_stack_raw: string | null
}

interface KindRow {
  failure_kind: string
  count: number
}

interface RunRow {
  run_id: string
  started_at: string
  ended_at: string | null
  duration_ms: number | null
  status: string | null
  total_tests: number | null
  passed_tests: number | null
  failed_tests: number | null
  errors_between_tests: number | null
  git_sha: string | null
  git_dirty: number | null
}

interface HotFileRow {
  test_file: string
  fails: number
  distinct_tests: number
}

interface Summary {
  activeFlakyTests: number
  dominantKind: { kind: string; count: number } | null
  worstFile: { file: string; fails: number } | null
  recentRunPassRate: number | null
}

/** Read all summary/detail rowsets from the SQLite DB in a single read-only session. */
function loadData(): {
  summary: Summary
  flaky: FlakyRow[]
  kinds: KindRow[]
  recentRuns: RunRow[]
  hotFiles: HotFileRow[]
  totalFailures: number
  totalRuns: number
} {
  const db = new Database(DB_PATH, { readonly: true })

  const flaky = db
    .query(
      `SELECT f.test_file, f.test_name,
              COUNT(*) AS fails,
              MAX(f.failed_at) AS last_failed,
              GROUP_CONCAT(DISTINCT f.failure_kind) AS kinds,
              MAX(CASE WHEN f.error_message IS NOT NULL
                       THEN f.failed_at || CHAR(1) || f.error_message END) AS error_message_raw,
              MAX(CASE WHEN f.error_stack IS NOT NULL
                       THEN f.failed_at || CHAR(1) || f.error_stack END) AS error_stack_raw
         FROM failures f
         JOIN runs r ON r.run_id = f.run_id
        WHERE r.failed_tests < ${MAX_FAILED_TESTS_PER_RUN}
          AND r.ended_at IS NOT NULL
          AND f.failed_at > datetime('now', '-30 days')
        GROUP BY f.test_file, f.test_name
        ORDER BY fails DESC
        LIMIT 20`,
    )
    .all() as FlakyRow[]

  const kinds = db
    .query(
      `SELECT failure_kind, COUNT(*) AS count
         FROM failures
        WHERE failed_at > datetime('now', '-30 days')
        GROUP BY failure_kind
        ORDER BY count DESC`,
    )
    .all() as KindRow[]

  const recentRuns = db
    .query(
      `SELECT run_id, started_at, ended_at, duration_ms, status,
              total_tests, passed_tests, failed_tests, errors_between_tests,
              git_sha, git_dirty
         FROM runs
        ORDER BY started_at DESC
        LIMIT 20`,
    )
    .all() as RunRow[]

  const hotFiles = db
    .query(
      `SELECT test_file,
              COUNT(*) AS fails,
              COUNT(DISTINCT test_name) AS distinct_tests
         FROM failures
        WHERE failed_at > datetime('now', '-30 days')
        GROUP BY test_file
        ORDER BY fails DESC
        LIMIT 15`,
    )
    .all() as HotFileRow[]

  const totalFailures = (
    db.query('SELECT COUNT(*) AS n FROM failures').get() as { n: number }
  ).n
  const totalRuns = (
    db.query('SELECT COUNT(*) AS n FROM runs').get() as { n: number }
  ).n

  const activeFlakyTests = (
    db
      .query(
        `SELECT COUNT(*) AS n FROM (
           SELECT 1
             FROM failures f
             JOIN runs r ON r.run_id = f.run_id
            WHERE r.failed_tests < ${MAX_FAILED_TESTS_PER_RUN}
              AND r.ended_at IS NOT NULL
              AND f.failed_at > datetime('now', '-30 days')
            GROUP BY f.test_file, f.test_name
           HAVING COUNT(*) >= 2
         )`,
      )
      .get() as { n: number }
  ).n

  const dominantKindRow = db
    .query(
      `SELECT failure_kind AS kind, COUNT(*) AS count
         FROM failures
        WHERE failed_at > datetime('now', '-30 days')
        GROUP BY failure_kind
        ORDER BY count DESC
        LIMIT 1`,
    )
    .get() as { kind: string; count: number } | null

  const worstFileRow = db
    .query(
      `SELECT test_file AS file, COUNT(*) AS fails
         FROM failures
        WHERE failed_at > datetime('now', '-30 days')
        GROUP BY test_file
        ORDER BY fails DESC
        LIMIT 1`,
    )
    .get() as { file: string; fails: number } | null

  const recentRunStats = db
    .query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN status = 'pass' THEN 1 ELSE 0 END) AS passed
         FROM runs
        WHERE ended_at IS NOT NULL
          AND started_at > datetime('now', '-30 days')`,
    )
    .get() as { total: number; passed: number }

  const recentRunPassRate =
    recentRunStats.total > 0
      ? recentRunStats.passed / recentRunStats.total
      : null

  db.close()

  return {
    summary: {
      activeFlakyTests,
      dominantKind: dominantKindRow,
      worstFile: worstFileRow,
      recentRunPassRate,
    },
    flaky,
    kinds,
    recentRuns,
    hotFiles,
    totalFailures,
    totalRuns,
  }
}

/** Bucket a failure count into a CSS severity class so the UI can colour-code it. */
function severityClass(count: number): string {
  if (count >= 10) return 'sev-high'
  if (count >= 5) return 'sev-med'
  if (count >= 2) return 'sev-low'
  return 'sev-single'
}

/** Render a failure-kind label as an escaped, class-tagged HTML badge. */
function kindBadge(kind: string): string {
  const safe = escapeHtml(kind)
  return `<span class="badge kind-${safe}">${safe}</span>`
}

/** Humanize a millisecond duration as ms/s/min so run rows stay scannable. */
function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = ms / 1000
  if (s < 60) return `${s.toFixed(1)}s`
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`
}

/** Trim a git SHA to the conventional 7-char prefix for compact display. */
function shortSha(sha: string | null): string {
  if (sha === null) return '—'
  return sha.slice(0, 7)
}

/** Convert an ISO timestamp to a coarse "Xs/m/h/d ago" string for at-a-glance recency. */
function formatRelative(iso: string): string {
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diffSec < 60) return `${diffSec}s ago`
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
  return `${Math.floor(diffSec / 86400)}d ago`
}

/** Map a pass-rate percentage to a tone class so the summary card reflects health at a glance. */
function passRateTone(pct: number | null): string {
  if (pct === null) return 'tone-muted'
  if (pct >= 95) return 'tone-good'
  if (pct >= 80) return 'tone-warn'
  return 'tone-bad'
}

/** Render the four top-of-page summary cards (flaky count, pass rate, dominant kind, worst file). */
function renderSummary(s: Summary): string {
  let flakyTone = 'tone-bad'
  if (s.activeFlakyTests === 0) flakyTone = 'tone-good'
  else if (s.activeFlakyTests <= 3) flakyTone = 'tone-warn'
  const flakyLabel =
    s.activeFlakyTests === 0
      ? 'none'
      : `${s.activeFlakyTests} test${s.activeFlakyTests === 1 ? '' : 's'}`
  const kindLabel = s.dominantKind
    ? `<span class="badge kind-${escapeHtml(s.dominantKind.kind)}">${escapeHtml(s.dominantKind.kind)}</span>`
    : '<span class="muted">—</span>'
  const fileLabel = s.worstFile
    ? escapeHtml(s.worstFile.file.split('/').pop() ?? s.worstFile.file)
    : '—'
  const pct =
    s.recentRunPassRate !== null ? Math.round(s.recentRunPassRate * 100) : null

  return `<section class="summary-grid">
    <div class="summary-card ${flakyTone}">
      <div class="summary-label">Active flaky tests</div>
      <div class="summary-value">${flakyLabel}</div>
      <div class="summary-hint">Distinct tests that failed &ge;2&times; in last 30 days</div>
    </div>
    <div class="summary-card ${passRateTone(pct)}">
      <div class="summary-label">Recent run pass rate</div>
      <div class="summary-value">${pct !== null ? `${pct}%` : '—'}</div>
      <div class="summary-hint">Clean runs over last 30 days</div>
    </div>
    <div class="summary-card">
      <div class="summary-label">Dominant failure kind</div>
      <div class="summary-value">${kindLabel}</div>
      <div class="summary-hint">${s.dominantKind ? escapeHtml(`${s.dominantKind.count} failures`) : 'no failures'}</div>
    </div>
    <div class="summary-card"${s.worstFile ? ` title="${escapeHtml(s.worstFile.file)}"` : ''}>
      <div class="summary-label">Worst file</div>
      <div class="summary-value mono summary-file">${fileLabel}</div>
      <div class="summary-hint">${s.worstFile ? escapeHtml(`${s.worstFile.fails} failures`) : 'no failures'}</div>
    </div>
  </section>`
}

/** Adapt a raw SQL row into the shared FlakyPattern shape so the prompt generator can consume it. */
function flakyRowToPattern(row: FlakyRow): FlakyPattern {
  return {
    testFile: row.test_file,
    testName: row.test_name,
    recentFails: row.fails,
    priorFails: 0,
    failureKinds: row.kinds
      .split(',')
      .map((kind) => kind.trim()) as FlakyPattern['failureKinds'],
    lastErrorMessage:
      row.error_message_raw != null
        ? stripTimestampPrefix(row.error_message_raw)
        : null,
    lastErrorStack:
      row.error_stack_raw != null
        ? stripTimestampPrefix(row.error_stack_raw)
        : null,
    lastFailed: row.last_failed,
  }
}

/** Render the flaky-tests table with per-row copyable AI prompts for triage. */
function renderFlaky(rows: FlakyRow[]): string {
  if (rows.length === 0)
    return '<p class="empty">No failures in the last 30 days. Clean house.</p>'
  const items = rows
    .map((r) => {
      const kinds = r.kinds
        .split(',')
        .map((k) => kindBadge(k.trim()))
        .join(' ')
      const prompt = generatePrompt(flakyRowToPattern(r), 30)
      const escapedPrompt = escapeHtml(prompt)
      return `<tr>
      <td><span class="count ${severityClass(r.fails)}">${r.fails}</span></td>
      <td class="test-name">${escapeHtml(r.test_name)}</td>
      <td class="file-path">${escapeHtml(r.test_file)}</td>
      <td>${kinds}</td>
      <td class="muted">${formatRelative(r.last_failed)}</td>
      <td class="prompt-actions">
        <button class="copy-btn" data-prompt="${escapedPrompt}" title="Copy AI prompt">Copy</button>
        <button class="expand-btn" title="Show prompt">&#9660;</button>
      </td>
    </tr>
    <tr class="prompt-row" hidden>
      <td colspan="6"><pre class="prompt-text">${escapedPrompt}</pre></td>
    </tr>`
    })
    .join('')
  return `<table>
    <thead><tr><th>Fails</th><th>Test</th><th>File</th><th>Kinds</th><th>Last seen</th><th>AI Prompt</th></tr></thead>
    <tbody>${items}</tbody>
  </table>`
}

/** Render the failure-kind distribution grid with absolute counts and percentages. */
function renderKinds(rows: KindRow[]): string {
  if (rows.length === 0) return '<p class="empty">No data.</p>'
  const total = rows.reduce((s, r) => s + r.count, 0)
  return `<div class="kind-grid">${rows
    .map((r) => {
      const pct = total === 0 ? 0 : Math.round((r.count / total) * 100)
      return `<div class="kind-card kind-${escapeHtml(r.failure_kind)}">
      <div class="kind-label">${escapeHtml(r.failure_kind)}</div>
      <div class="kind-count">${r.count}</div>
      <div class="kind-pct">${pct}%</div>
    </div>`
    })
    .join('')}</div>`
}

/** Map a run status to its badge CSS class; null is treated as a crash. */
function statusClass(status: string | null): string {
  if (status === 'pass') return 'status-pass'
  if (status === 'fail') return 'status-fail'
  return 'status-crashed'
}

/** Render the recent-runs table showing status, timing, counts, and git context. */
function renderRuns(rows: RunRow[]): string {
  if (rows.length === 0) return '<p class="empty">No runs recorded.</p>'
  const items = rows
    .map((r) => {
      const dirty =
        r.git_dirty === 1
          ? '<span class="dirty" title="working tree dirty">●</span>'
          : ''
      const passed = r.passed_tests ?? 0
      const failed = r.failed_tests ?? 0
      const errs = r.errors_between_tests ?? 0
      return `<tr>
      <td><span class="status ${statusClass(r.status)}">${r.status ?? 'crashed'}</span></td>
      <td class="muted">${formatRelative(r.started_at)}</td>
      <td>${formatDuration(r.duration_ms)}</td>
      <td>${r.total_tests ?? 0}</td>
      <td>${passed > 0 ? `<span class="pass-count">${passed}</span>` : '0'}</td>
      <td>${failed > 0 ? `<span class="fail-count">${failed}</span>` : '0'}</td>
      <td>${errs > 0 ? `<span class="fail-count" title="errors outside tests">${errs}</span>` : '0'}</td>
      <td class="muted mono">${shortSha(r.git_sha)}${dirty}</td>
    </tr>`
    })
    .join('')
  return `<table>
    <thead><tr><th>Status</th><th>When</th><th>Duration</th><th>Total</th><th>Passed</th><th>Failed</th><th>Errors</th><th>SHA</th></tr></thead>
    <tbody>${items}</tbody>
  </table>`
}

/** Render the per-file hot-spot table, attaching the flakiest test's AI prompt when available. */
function renderHotFiles(rows: HotFileRow[], flakyRows: FlakyRow[]): string {
  if (rows.length === 0) return '<p class="empty">No data.</p>'
  const items = rows
    .map((r) => {
      const worstTest = flakyRows.find((f) => f.test_file === r.test_file)
      let promptCell = ''
      if (worstTest) {
        const prompt = generatePrompt(flakyRowToPattern(worstTest), 30)
        const escapedPrompt = escapeHtml(prompt)
        promptCell = `<td class="prompt-actions">
          <button class="copy-btn" data-prompt="${escapedPrompt}" title="Copy AI prompt for worst test">Copy</button>
          <button class="expand-btn" title="Show prompt">&#9660;</button>
        </td>`
        return `<tr>
      <td><span class="count ${severityClass(r.fails)}">${r.fails}</span></td>
      <td>${r.distinct_tests}</td>
      <td class="file-path">${escapeHtml(r.test_file)}</td>
      ${promptCell}
    </tr>
    <tr class="prompt-row" hidden>
      <td colspan="4"><pre class="prompt-text">${escapedPrompt}</pre></td>
    </tr>`
      }
      return `<tr>
      <td><span class="count ${severityClass(r.fails)}">${r.fails}</span></td>
      <td>${r.distinct_tests}</td>
      <td class="file-path">${escapeHtml(r.test_file)}</td>
      <td></td>
    </tr>`
    })
    .join('')
  return `<table>
    <thead><tr><th>Fails</th><th>Distinct tests</th><th>File</th><th>AI Prompt</th></tr></thead>
    <tbody>${items}</tbody>
  </table>`
}

const STYLES = `
:root {
  --bg: #0d1117; --surface: #161b22; --surface-2: #1f2630; --border: #30363d;
  --text: #e6edf3; --text-muted: #8b949e; --accent: #58a6ff;
  --pass: #3fb950; --fail: #f85149; --warn: #d29922; --crashed: #8b949e;
  --kind-assertion: #58a6ff; --kind-timeout: #d29922;
  --kind-uncaught: #f85149; --kind-unknown: #8b949e;
  --sev-single: #3fb950; --sev-low: #d29922; --sev-med: #fb8500; --sev-high: #f85149;
}
* { box-sizing: border-box; }
body { font: 14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; background: var(--bg); color: var(--text); margin: 0; padding: 2rem; max-width: 1200px; margin-inline: auto; }
header { display: flex; align-items: center; justify-content: space-between; gap: 2rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border); margin-bottom: 2rem; }
.header-logo { width: 48px; height: 48px; border-radius: 6px; }
h1 { margin: 0; font-size: 1.5rem; font-weight: 600; font-family: ui-monospace,"SF Mono",Menlo,Consolas,monospace; }
h2 { margin: 2rem 0 1rem; font-size: 1.1rem; font-weight: 600; }
.subtitle { color: var(--text-muted); font-size: 0.85rem; }
section { margin-bottom: 2.5rem; }
table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
th, td { text-align: left; padding: 0.6rem 0.9rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
th { background: var(--surface-2); font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text-muted); }
tr:last-child td { border-bottom: none; }
tr:hover td { background: var(--surface-2); }
.muted { color: var(--text-muted); }
.mono { font-family: ui-monospace,"SF Mono",Menlo,Consolas,monospace; }
.file-path { font-family: ui-monospace,"SF Mono",Menlo,Consolas,monospace; font-size: 0.85rem; color: var(--text-muted); }
.test-name { font-weight: 500; }
.count { display: inline-block; min-width: 2.25rem; text-align: center; padding: 0.2rem 0.5rem; border-radius: 4px; font-weight: 600; font-family: ui-monospace,"SF Mono",Menlo,Consolas,monospace; font-size: 0.85rem; }
.sev-single { background: color-mix(in srgb,var(--sev-single) 20%,transparent); color: var(--sev-single); }
.sev-low    { background: color-mix(in srgb,var(--sev-low) 20%,transparent); color: var(--sev-low); }
.sev-med    { background: color-mix(in srgb,var(--sev-med) 25%,transparent); color: var(--sev-med); }
.sev-high   { background: color-mix(in srgb,var(--sev-high) 25%,transparent); color: var(--sev-high); }
.badge { display: inline-block; padding: 0.1rem 0.45rem; border-radius: 999px; font-size: 0.75rem; font-weight: 500; border: 1px solid transparent; }
.kind-assertion { background: color-mix(in srgb,var(--kind-assertion) 18%,transparent); color: var(--kind-assertion); border-color: color-mix(in srgb,var(--kind-assertion) 35%,transparent); }
.kind-timeout   { background: color-mix(in srgb,var(--kind-timeout) 20%,transparent); color: var(--kind-timeout); border-color: color-mix(in srgb,var(--kind-timeout) 40%,transparent); }
.kind-uncaught  { background: color-mix(in srgb,var(--kind-uncaught) 20%,transparent); color: var(--kind-uncaught); border-color: color-mix(in srgb,var(--kind-uncaught) 40%,transparent); }
.kind-unknown   { background: color-mix(in srgb,var(--kind-unknown) 20%,transparent); color: var(--kind-unknown); border-color: color-mix(in srgb,var(--kind-unknown) 40%,transparent); }
.kind-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(160px,1fr)); gap: 1rem; }
.kind-card { padding: 1rem; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); }
.kind-card.kind-assertion { border-left: 4px solid var(--kind-assertion); }
.kind-card.kind-timeout   { border-left: 4px solid var(--kind-timeout); }
.kind-card.kind-uncaught  { border-left: 4px solid var(--kind-uncaught); }
.kind-card.kind-unknown   { border-left: 4px solid var(--kind-unknown); }
.kind-label { text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.08em; color: var(--text-muted); font-weight: 600; }
.kind-count { font-size: 2rem; font-weight: 700; margin-top: 0.25rem; }
.kind-pct { color: var(--text-muted); font-size: 0.8rem; }
.status { display: inline-block; padding: 0.15rem 0.55rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.status-pass    { background: color-mix(in srgb,var(--pass) 20%,transparent); color: var(--pass); }
.status-fail    { background: color-mix(in srgb,var(--fail) 20%,transparent); color: var(--fail); }
.status-crashed { background: color-mix(in srgb,var(--crashed) 25%,transparent); color: var(--crashed); }
.fail-count { color: var(--fail); font-weight: 600; }
.pass-count { color: var(--pass); font-weight: 600; }
.dirty { color: var(--warn); margin-left: 0.3rem; font-size: 0.7rem; }
.summary-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(200px,1fr)); gap: 1rem; margin-bottom: 2.5rem; }
.summary-card { padding: 1rem 1.25rem; border-radius: 8px; border: 1px solid var(--border); background: var(--surface); border-left: 4px solid var(--text-muted); }
.summary-card.tone-good { border-left-color: var(--pass); }
.summary-card.tone-warn { border-left-color: var(--warn); }
.summary-card.tone-bad  { border-left-color: var(--fail); }
.summary-card.tone-muted { border-left-color: var(--text-muted); }
.summary-label { text-transform: uppercase; font-size: 0.7rem; letter-spacing: 0.08em; color: var(--text-muted); font-weight: 600; }
.summary-value { font-size: 1.75rem; font-weight: 700; margin-top: 0.25rem; line-height: 1.2; }
.summary-file { font-size: 1rem; word-break: break-all; }
.summary-hint { color: var(--text-muted); font-size: 0.8rem; margin-top: 0.35rem; }
footer { margin-top: 3rem; padding-top: 1.5rem; border-top: 1px solid var(--border); text-align: center; color: var(--text-muted); font-size: 0.8rem; }
footer a { color: var(--text-muted); text-decoration: none; border-bottom: 1px dotted var(--border); }
footer a:hover { color: var(--accent); border-bottom-color: var(--accent); }
.sep { color: var(--border); margin: 0 0.6rem; }
.empty { padding: 2rem; text-align: center; color: var(--text-muted); background: var(--surface); border: 1px dashed var(--border); border-radius: 6px; }
.prompt-actions { white-space: nowrap; }
.copy-btn, .expand-btn { background: var(--surface-2); color: var(--text-muted); border: 1px solid var(--border); border-radius: 4px; padding: 0.2rem 0.5rem; font-size: 0.75rem; cursor: pointer; font-family: inherit; }
.copy-btn:hover, .expand-btn:hover { color: var(--text); border-color: var(--accent); }
.copy-btn.copied { color: var(--pass); border-color: var(--pass); }
.prompt-row td { padding: 0; }
.prompt-row:not([hidden]) td { padding: 0.75rem 0.9rem; background: var(--surface-2); }
.prompt-text { margin: 0; white-space: pre-wrap; word-break: break-word; font-size: 0.8rem; line-height: 1.6; color: var(--text); font-family: ui-monospace,"SF Mono",Menlo,Consolas,monospace; }
tr.prompt-row:hover td { background: var(--surface-2); }
`

/** Locate the Mr. Flaky logo by walking up from this file and inline it as a data URI for portability. */
function loadLogo(): string | null {
  try {
    // Walk up from this file to find the logo at the repo root
    let directory = dirname(new URL(import.meta.url).pathname)
    for (let i = 0; i < 5; i++) {
      for (const filename of ['mrflaky-48.png', 'mrflaky.png']) {
        try {
          const buffer = readFileSync(resolve(directory, filename))
          return `data:image/png;base64,${buffer.toString('base64')}`
        } catch {
          /* not here */
        }
      }
      directory = dirname(directory)
    }
    return null
  } catch {
    return null
  }
}

/** Assemble the full self-contained HTML document from the loaded dataset. */
function render(data: ReturnType<typeof loadData>): string {
  const logoDataUri = loadLogo()
  const logoHtml = logoDataUri
    ? `<img src="${logoDataUri}" alt="Mr. Flaky" class="header-logo">`
    : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>flaky-tests report</title>
<style>${STYLES}</style>
</head>
<body>
  <header>
    <div style="display:flex;align-items:center;gap:0.75rem">
      ${logoHtml}
      <h1>flaky-tests</h1>
      <div class="subtitle">Generated ${escapeHtml(new Date().toISOString())} &middot; ${escapeHtml(DB_PATH)}</div>
    </div>
    <div style="display:flex;gap:2rem;color:var(--text-muted);font-size:0.9rem">
      <div><strong style="color:var(--text)">${data.totalRuns}</strong> runs</div>
      <div><strong style="color:var(--text)">${data.totalFailures}</strong> recorded failures</div>
    </div>
  </header>

  ${renderSummary(data.summary)}

  <section>
    <h2>Top 20 flaky tests (last 30 days)</h2>
    <p class="subtitle">Runs with &ge;10 simultaneous failures and crashed runs excluded.</p>
    ${renderFlaky(data.flaky)}
  </section>

  <section>
    <h2>Failure kinds (last 30 days)</h2>
    ${renderKinds(data.kinds)}
  </section>

  <section>
    <h2>Hot spots by file (last 30 days)</h2>
    ${renderHotFiles(data.hotFiles, data.flaky)}
  </section>

  <section>
    <h2>Recent runs</h2>
    ${renderRuns(data.recentRuns)}
  </section>

  <footer>
    Generated by <a href="https://github.com/brewpirate/flaky-tests">flaky-tests</a>
  </footer>
  <script>
  document.addEventListener('click', function(event) {
    var target = event.target;
    if (target.classList.contains('copy-btn')) {
      navigator.clipboard.writeText(target.dataset.prompt).then(function() {
        target.textContent = 'Copied!';
        target.classList.add('copied');
        setTimeout(function() { target.textContent = 'Copy'; target.classList.remove('copied'); }, 1500);
      });
    }
    if (target.classList.contains('expand-btn')) {
      var promptRow = target.closest('tr').nextElementSibling;
      var isHidden = promptRow.hasAttribute('hidden');
      promptRow.toggleAttribute('hidden');
      target.textContent = isHidden ? '\u25B2' : '\u25BC';
    }
  });
  </script>
</body>
</html>`
}

/** Spawn a detached platform-appropriate opener for the generated report; failures are non-fatal. */
function openInBrowser(filePath: string): void {
  const abs = Bun.fileURLToPath(new URL(filePath, `file://${process.cwd()}/`))
  const url = `file://${abs}`
  const envBrowser = process.env.BROWSER
  let cmd: string[]
  if (envBrowser) cmd = [envBrowser, url]
  else if (process.platform === 'darwin') cmd = ['open', url]
  else if (process.platform === 'win32') cmd = ['cmd', '/c', 'start', '', url]
  else cmd = ['xdg-open', url]
  try {
    Bun.spawn({ cmd, stdout: 'ignore', stderr: 'ignore' }).unref?.()
  } catch (e) {
    console.warn(`[flaky-tests] Could not open browser:`, e)
  }
}

/** CLI entry point: verify the DB exists, load data, write the HTML report, optionally open it. */
async function main(): Promise<void> {
  if (!(await Bun.file(DB_PATH).exists())) {
    console.error(
      `[flaky-tests] DB not found at ${DB_PATH}. Run tests at least once.`,
    )
    process.exit(1)
  }
  const data = loadData()
  const html = render(data)
  await Bun.write(OUT_PATH, html)
  console.log(
    `[flaky-tests] Wrote ${OUT_PATH} (${data.totalRuns} runs, ${data.totalFailures} failures)`,
  )
  if (process.argv.includes('--open')) openInBrowser(OUT_PATH)
}

await main()
