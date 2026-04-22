import type { FlakyPattern } from '@flaky-tests/core'
import type { HotFile, KindBreakdown, RecentRun, RunFailure } from './types'
import {
  esc,
  failColor,
  formatDuration,
  formatRelative,
  kindColor,
  kindRgb,
  PERCENT_SCALE,
  SEVERITY_CRITICAL_THRESHOLD,
  severityRank,
  shortSha,
} from './utils'

/** Dashboard aggregate bundle passed in by generateHtml when the report runs
 *  with recent-run context; the pattern list renders regardless of whether
 *  this is supplied. */
export interface DashboardData {
  recentRuns: RecentRun[]
  kindBreakdown: KindBreakdown[]
  hotFiles: HotFile[]
  failuresByRun: Map<string, RunFailure[]>
}

/** Builds the top-of-report stat strip — the at-a-glance summary readers see
 *  before scrolling into individual patterns or dashboard tables. */
export function renderSummaryStats(
  patterns: FlakyPattern[],
  dashboard: DashboardData | undefined,
  windowDays: number,
): string {
  const totalRecentFails = patterns.reduce((s, p) => s + p.recentFails, 0)
  const critical = patterns.filter(
    (p) => p.recentFails >= SEVERITY_CRITICAL_THRESHOLD,
  ).length
  const hotFileCount = dashboard?.hotFiles.length ?? 0
  const lastRunRelative = dashboard?.recentRuns[0]
    ? formatRelative(dashboard.recentRuns[0].startedAt)
    : '—'

  const patternsColor = patterns.length > 0 ? 'var(--yellow)' : 'var(--muted)'
  const criticalColor = critical > 0 ? 'var(--red)' : 'var(--muted)'
  return `
    <section class="stat-strip">
      <div class="stat-cell">
        <span class="stat-cell-value" style="color:${patternsColor}">${patterns.length}</span>
        <span class="stat-cell-label">patterns</span>
        <span class="stat-cell-desc">Tests failing ≥2× in window</span>
      </div>
      <div class="stat-cell">
        <span class="stat-cell-value" style="color:${criticalColor}">${critical}</span>
        <span class="stat-cell-label">critical</span>
        <span class="stat-cell-desc">Tests with ≥10 fails</span>
      </div>
      <div class="stat-cell">
        <span class="stat-cell-value" style="color:${failColor(totalRecentFails)}">${totalRecentFails}</span>
        <span class="stat-cell-label">fails / ${windowDays}d</span>
        <span class="stat-cell-desc">Total recent failure events</span>
      </div>
      <div class="stat-cell">
        <span class="stat-cell-value">${hotFileCount}</span>
        <span class="stat-cell-label">hot files</span>
        <span class="stat-cell-desc">Distinct files producing failures</span>
      </div>
      <div class="stat-cell">
        <span class="stat-cell-value stat-small">${lastRunRelative}</span>
        <span class="stat-cell-label">last run</span>
        <span class="stat-cell-desc">Most recent test session</span>
      </div>
    </section>`
}

/** Emits the sticky sidebar index — pattern anchors plus dashboard jump
 *  links — so long reports remain navigable without a JS runtime. */
export function renderToc(
  patterns: FlakyPattern[],
  hasDashboard: boolean,
): string {
  if (patterns.length === 0 && !hasDashboard) {
    return '<div></div>'
  }
  const items = patterns
    .map((p, i) => {
      const sev = severityRank(p.recentFails)
      return `<li><a href="#pattern-${i + 1}" class="toc-link">
        <span class="toc-sev ${sev.className}"></span>
        <span class="toc-num">${i + 1}</span>
        <span class="toc-name">${esc(p.testName)}</span>
        <span class="toc-fails">${p.recentFails}</span>
      </a></li>`
    })
    .join('')
  const dashLinks = hasDashboard
    ? `<div class="toc-section">
        <a href="#dashboard">Kind breakdown</a>
        <a href="#hot-files">Hot files</a>
        <a href="#recent-runs">Recent runs</a>
      </div>`
    : ''
  return `
    <nav class="toc" aria-label="Report index">
      ${patterns.length > 0 ? `<h2 class="toc-heading">Patterns</h2><ol class="toc-list">${items}</ol>` : ''}
      ${dashLinks}
    </nav>`
}

/** Renders the failure-kind distribution as a row of percentage cards, giving
 *  readers a quick sense of which error category dominates the window. */
function renderKindBar(kindBreakdown: KindBreakdown[]): string {
  const total = kindBreakdown.reduce((s, k) => s + k.count, 0)
  if (total === 0) {
    return '<p class="muted">No failures recorded.</p>'
  }

  const cards = kindBreakdown
    .map((k) => {
      const pct = total ? ((k.count / total) * PERCENT_SCALE).toFixed(0) : '0'
      const color = kindColor(k.failureKind)
      const rgb = kindRgb(k.failureKind)
      return `<div class="kind-card" style="border-left-color:${color};background:linear-gradient(135deg, rgba(${rgb}, 0.06) 0%, transparent 60%), var(--bg-elev)">
        <span class="kind-card-count" style="color:${color}">${k.count}</span>
        <span class="kind-card-label">${esc(k.failureKind)}</span>
        <span class="kind-card-pct">${pct}% of failures</span>
      </div>`
    })
    .join('')

  return `<div class="kind-cards">${cards}</div>`
}

/**
 * Builds a short investigation prompt for a hot file, used by the inline
 * copy button handler to seed an AI assistant conversation.
 */
function hotFilePrompt(
  file: string,
  fails: number,
  distinctTests: number,
  windowDays: number,
): string {
  return `Investigate ${file}: ${fails} failures across ${distinctTests} distinct tests in the last ${windowDays} days`
}

/** Inner table for an expanded run row — lists the individual failures that
 *  made up that run so readers can drill down without a separate page. */
function renderRunFailures(failures: RunFailure[]): string {
  if (failures.length === 0) {
    return '<p class="muted">No failures recorded.</p>'
  }
  const rows = failures
    .map((failure) => {
      const firstLine =
        failure.errorMessage?.split('\n')[0] ?? failure.errorMessage ?? ''
      const color = kindColor(failure.failureKind)
      const rgb = kindRgb(failure.failureKind)
      return `<tr>
          <td><code>${esc(failure.testName)}</code><div class="run-fail-file">${esc(failure.testFile)}</div></td>
          <td><span class="kind-badge" style="color:${color};background:rgba(${rgb}, 0.14);border-color:${color}">${esc(failure.failureKind)}</span></td>
          <td class="run-fail-err" title="${esc(failure.errorMessage ?? '')}"><code>${esc(firstLine)}</code></td>
          <td class="dim">${formatRelative(failure.failedAt)}</td>
        </tr>`
    })
    .join('\n')
  return `<table class="run-failures-table">
      <thead><tr><th>Test</th><th>Kind</th><th>Error</th><th>When</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`
}

/** Assembles the three aggregate sections (kind breakdown, hot files, recent
 *  runs) that appear below the pattern list when dashboard data is provided. */
export function renderDashboard(
  dashboard: DashboardData,
  windowDays: number,
): string {
  const hotRows = dashboard.hotFiles
    .map((h, idx) => {
      const promptId = `hf-${idx + 1}`
      const prompt = hotFilePrompt(
        h.testFile,
        h.fails,
        h.distinctTests,
        windowDays,
      )
      return `<tr>
      <td class="num" style="color:${failColor(h.fails)}">${h.fails}</td>
      <td class="num">${h.distinctTests}</td>
      <td><code>${esc(h.testFile)}</code></td>
      <td class="row-action">
        <button type="button" class="copy-btn" data-prompt-id="${promptId}" data-original="Copy">Copy</button>
        <span class="visually-hidden" id="${promptId}">${esc(prompt)}</span>
      </td>
    </tr>`
    })
    .join('\n')

  const runRows = dashboard.recentRuns
    .map((r) => {
      let statusClass = 'status-na'
      if (r.status === 'pass') {
        statusClass = 'status-pass'
      } else if (r.status === 'fail') {
        statusClass = 'status-fail'
      }
      const statusLabel = r.status ?? 'n/a'
      const failures = dashboard.failuresByRun.get(r.runId) ?? []
      const runIdAttr = esc(r.runId)
      return `<tr class="run-row" data-run-id="${runIdAttr}" tabindex="0">
      <td class="run-chevron-cell" aria-hidden="true"><svg class="run-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></td>
      <td><span class="status-badge ${statusClass}">${esc(statusLabel)}</span></td>
      <td class="dim">${formatRelative(r.startedAt)}</td>
      <td class="dim num">${formatDuration(r.durationMs)}</td>
      <td class="num">${r.totalTests ?? '—'}</td>
      <td class="num pass-num">${r.passedTests ?? '—'}</td>
      <td class="num fail-num">${r.failedTests ?? '—'}</td>
      <td class="num">${r.errorsBetweenTests ?? '—'}</td>
      <td><code class="dim">${shortSha(r.gitSha)}</code></td>
    </tr>
    <tr class="run-failures" data-run-id="${runIdAttr}" hidden>
      <td colspan="9">${renderRunFailures(failures)}</td>
    </tr>`
    })
    .join('\n')

  return `
    <section id="dashboard" class="dashboard-section">
      <h2 class="section-title">Failure Kind Breakdown</h2>
      ${renderKindBar(dashboard.kindBreakdown)}
    </section>

    <section id="hot-files" class="dashboard-section">
      <h2 class="section-title">Hot Files</h2>
      <div class="table-wrap">
        <table class="dash-table">
          <thead><tr><th class="num">Fails</th><th class="num">Tests</th><th>File</th><th></th></tr></thead>
          <tbody>${hotRows}</tbody>
        </table>
      </div>
    </section>

    <section id="recent-runs" class="dashboard-section">
      <h2 class="section-title">Recent Runs</h2>
      <div class="table-wrap">
        <table class="dash-table">
          <thead><tr><th aria-label="expand" class="run-chevron-cell"></th><th>Status</th><th>When</th><th class="num">Duration</th><th class="num">Total</th><th class="num">Passed</th><th class="num">Failed</th><th class="num">Errors</th><th>SHA</th></tr></thead>
          <tbody>${runRows}</tbody>
        </table>
      </div>
    </section>`
}
