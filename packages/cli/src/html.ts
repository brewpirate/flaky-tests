import type { FlakyPattern } from '@flaky-tests/core'
import { generatePrompt } from './prompt'

// Dashboard aggregate types. Kept local so the report file is self-contained
// and does not require extending the core package's public surface.
/** Count of failures grouped by error category for the dashboard summary. */
export interface KindBreakdown {
  failureKind: string
  count: number
}

/** Test file with high failure concentration — surfaces hotspots worth refactoring first. */
export interface HotFile {
  testFile: string
  fails: number
  distinctTests: number
}

/** Per-run summary shown in the report timeline; nullable fields cover runs still in flight or missing metadata. */
export interface RecentRun {
  runId: string
  startedAt: string
  endedAt: string | null
  durationMs: number | null
  totalTests: number | null
  passedTests: number | null
  failedTests: number | null
  errorsBetweenTests: number | null
  status: 'pass' | 'fail' | null
  gitSha: string | null
  gitDirty?: boolean | null
}

/** Individual failure attached to a run, rendered in the expandable drill-down view. */
export interface RunFailure {
  testName: string
  testFile: string
  failureKind: string
  errorMessage?: string | null
  failedAt: string
}

/** Minimal HTML-entity escape for user-controlled strings (test names, file
 *  paths, error messages) that get interpolated into the single-file report. */
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Buckets a recent-failure count into the four visual severity tiers that
 *  drive card accents, TOC dots, and pill colors throughout the report. */
function severityRank(recentFails: number): {
  label: string
  className: string
} {
  if (recentFails >= 10) {
    return { label: 'critical', className: 'sev-critical' }
  }
  if (recentFails >= 5) {
    return { label: 'high', className: 'sev-high' }
  }
  if (recentFails >= 2) {
    return { label: 'medium', className: 'sev-medium' }
  }
  return { label: 'low', className: 'sev-low' }
}

/** Collapses deep repo paths to the last three segments so card headers stay
 *  scannable without losing the locating suffix. */
function shortFile(path: string): string {
  const parts = path.split('/')
  if (parts.length <= 3) {
    return path
  }
  return `…/${parts.slice(-3).join('/')}`
}

/** Renders one flaky-pattern card — severity-colored header, stats, last error,
 *  and a collapsed investigation prompt with a copy affordance. */
function patternCard(p: FlakyPattern, i: number, windowDays: number): string {
  const prompt = generatePrompt(p, windowDays)
  const kinds = p.failureKinds.join(', ')
  const firstLine = p.lastErrorMessage?.split('\n')[0] ?? null
  const sev = severityRank(p.recentFails)
  const anchorId = `pattern-${i + 1}`

  return `
  <article class="card ${sev.className}" id="${anchorId}">
    <header class="card-header">
      <div class="card-header-main">
        <div class="card-title-row">
          <span class="sev-pill">${sev.label}</span>
          <span class="card-num">#${i + 1}</span>
          <h2 class="test-name">${esc(p.testName)}</h2>
        </div>
        <div class="card-file"><code>${esc(shortFile(p.testFile))}</code></div>
      </div>
      <div class="card-stats">
        <div class="stat-main">
          <span class="stat-value">${p.recentFails}</span>
          <span class="stat-label">fails / ${windowDays}d</span>
        </div>
        <div class="stat-sub">
          <span>${p.priorFails} prior</span>
          <span class="dot">·</span>
          <span>${esc(kinds)}</span>
        </div>
      </div>
    </header>
    ${
      firstLine
        ? `<div class="card-error"><span class="error-prefix">last error</span><code>${esc(firstLine)}</code></div>`
        : ''
    }
    <details class="prompt-section">
      <summary class="prompt-summary">
        <span class="prompt-summary-label">Investigation prompt</span>
        <span class="prompt-summary-right">
          <span class="prompt-summary-hint">click to expand</span>
          <button type="button" class="copy-btn" data-prompt-id="p-${i + 1}" data-original="Copy">Copy</button>
        </span>
      </summary>
      <pre class="prompt-body" id="p-${i + 1}">${esc(prompt)}</pre>
    </details>
  </article>`
}

/**
 * Formats a millisecond duration as a compact human string.
 */
function formatDuration(ms: number | null): string {
  if (ms == null) {
    return '—'
  }
  if (ms < 1000) {
    return `${ms}ms`
  }
  const s = ms / 1000
  if (s < 60) {
    return `${s.toFixed(1)}s`
  }
  const m = Math.floor(s / 60)
  const rem = Math.round(s % 60)
  return `${m}m ${rem}s`
}

/** Humanizes an ISO timestamp as a coarse "x ago" string — the report is
 *  read asynchronously so exact times are noise. */
function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) {
    return 'just now'
  }
  if (mins < 60) {
    return `${mins}m ago`
  }
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) {
    return `${hrs}h ago`
  }
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

/** Truncates a git SHA to the conventional 7-char display form, with an
 *  em-dash placeholder when the run has no recorded commit. */
function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : '—'
}

/** Maps a failure category to a themed CSS variable so assertions, timeouts,
 *  and uncaught errors are visually distinct at a glance. */
function kindColor(kind: string): string {
  switch (kind) {
    case 'assertion':
      return 'var(--blue)'
    case 'timeout':
      return 'var(--yellow)'
    case 'uncaught':
      return 'var(--red)'
    default:
      return 'var(--subtext)'
  }
}

/** Same category-to-color mapping as kindColor, but returns the raw RGB
 *  triple for use inside rgba() gradients and tinted backgrounds. */
function kindRgb(kind: string): string {
  switch (kind) {
    case 'assertion':
      return 'var(--blue-rgb)'
    case 'timeout':
      return 'var(--yellow-rgb)'
    case 'uncaught':
      return 'var(--red-rgb)'
    default:
      return '139, 148, 176'
  }
}

/** Picks a numeric color for failure counts so totals in the stat strip and
 *  hot-files table self-flag as healthy, concerning, or critical. */
function failColor(n: number): string {
  if (n >= 10) {
    return 'var(--red)'
  }
  if (n >= 5) {
    return 'var(--yellow)'
  }
  if (n >= 2) {
    return 'var(--text)'
  }
  return 'var(--green)'
}

/** Builds the top-of-report stat strip — the at-a-glance summary readers see
 *  before scrolling into individual patterns or dashboard tables. */
function renderSummaryStats(
  patterns: FlakyPattern[],
  dashboard:
    | {
        recentRuns: RecentRun[]
        kindBreakdown: KindBreakdown[]
        hotFiles: HotFile[]
        failuresByRun: Map<string, RunFailure[]>
      }
    | undefined,
  windowDays: number,
): string {
  const totalRecentFails = patterns.reduce((s, p) => s + p.recentFails, 0)
  const critical = patterns.filter((p) => p.recentFails >= 10).length
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
function renderToc(patterns: FlakyPattern[], hasDashboard: boolean): string {
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
      const pct = total ? ((k.count / total) * 100).toFixed(0) : '0'
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
function renderDashboard(
  dashboard: {
    recentRuns: RecentRun[]
    kindBreakdown: KindBreakdown[]
    hotFiles: HotFile[]
    failuresByRun: Map<string, RunFailure[]>
  },
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

/**
 * Generates a self-contained HTML report for detected flaky test patterns.
 * Emits a dark-themed, no-JS single-file HTML document. Interactivity is
 * achieved via `<details>` and anchor links only. Preserves the `esc()`
 * boundary for every untrusted string.
 *
 * @param patterns - Flaky test patterns to render (order is respected)
 * @param windowDays - Detection window size in days; surfaced in headings and prompts
 * @param dashboard - Optional aggregate stats (kind breakdown, hot files, recent runs)
 * @returns Complete HTML document string
 */
export function generateHtml(
  patterns: FlakyPattern[],
  windowDays: number,
  dashboard?: {
    recentRuns: RecentRun[]
    kindBreakdown: KindBreakdown[]
    hotFiles: HotFile[]
    failuresByRun: Map<string, RunFailure[]>
  },
): string {
  const plural = patterns.length === 1 ? 'pattern' : 'patterns'
  const cards = patterns.map((p, i) => patternCard(p, i, windowDays)).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>flaky-tests — ${patterns.length} ${plural} detected</title>
  <script>
    (function () {
      try {
        var stored = localStorage.getItem('flaky-theme');
        if (stored === 'light') document.documentElement.classList.add('light');
        else if (stored === 'dark') document.documentElement.classList.add('dark');
      } catch (err) { /* localStorage may be unavailable on file:// */ }
    })();
  </script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #0a0b14;
      --bg-elev: #141625;
      --surface: #1d2036;
      --surface2: #2a2e4a;
      --border: #232642;
      --border-strong: #3d4270;
      --text: #e6edf3;
      --subtext: #b4bcd0;
      --muted: #8b94b0;
      --red: #ff4d6d;
      --red-rgb: 255, 77, 109;
      --red-dim: #3d1525;
      --coral: #ff7a59;
      --coral-rgb: 255, 122, 89;
      --orange: #ff9e4d;
      --orange-rgb: 255, 158, 77;
      --green: #3ddc97;
      --green-rgb: 61, 220, 151;
      --green-dim: #0f2e22;
      --yellow: #ffb454;
      --yellow-rgb: 255, 180, 84;
      --blue: #5cc8ff;
      --blue-rgb: 92, 200, 255;
      --mauve: #c792ea;
      --purple: #bd5cff;
      --purple-rgb: 189, 92, 255;
      --pink: #ff6ac1;
      --radius: 8px;
      --radius-sm: 5px;
      --font-sans: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      --font-mono: 'Cascadia Code', 'Fira Code', 'JetBrains Mono', ui-monospace, monospace;
    }

    /* ---- Light palette overrides ---- */
    :root.light {
      --bg: #f6f7f9;
      --bg-elev: #ffffff;
      --surface: #eef0f4;
      --surface2: #e2e6ed;
      --border: #d8dde4;
      --border-strong: #b8c0cc;
      --text: #1a1f2e;
      --subtext: #3a4256;
      --muted: #5c6578;
      --red: #d6336c;
      --red-rgb: 214, 51, 108;
      --red-dim: #fce6ee;
      --coral: #e5541f;
      --coral-rgb: 229, 84, 31;
      --orange: #e8590c;
      --orange-rgb: 232, 89, 12;
      --green: #2b8a3e;
      --green-rgb: 43, 138, 62;
      --green-dim: #e3f5e8;
      --yellow: #b88200;
      --yellow-rgb: 184, 130, 0;
      --blue: #1971c2;
      --blue-rgb: 25, 113, 194;
      --mauve: #7048e8;
      --purple: #7048e8;
      --purple-rgb: 112, 72, 232;
      --pink: #c2255c;
    }
    :root.light .card {
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
    }
    :root.light .kind-card,
    :root.light .table-wrap,
    :root.light .stat-cell {
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
    }
    :root.light .card.sev-critical {
      background: linear-gradient(90deg, rgba(var(--red-rgb), 0.08) 0%, transparent 22%), var(--bg-elev);
    }
    :root.light .card-error {
      background: rgba(var(--red-rgb), 0.06);
    }
    :root.light .prompt-summary {
      background: rgba(0, 0, 0, 0.03);
    }
    :root.light .prompt-summary:hover {
      background: rgba(0, 0, 0, 0.06);
    }

    @media (prefers-color-scheme: light) {
      :root:not(.dark):not(.light) {
        --bg: #f6f7f9;
        --bg-elev: #ffffff;
        --surface: #eef0f4;
        --surface2: #e2e6ed;
        --border: #d8dde4;
        --border-strong: #b8c0cc;
        --text: #1a1f2e;
        --subtext: #3a4256;
        --muted: #5c6578;
        --red: #d6336c;
        --red-rgb: 214, 51, 108;
        --red-dim: #fce6ee;
        --coral: #e5541f;
        --coral-rgb: 229, 84, 31;
        --orange: #e8590c;
        --orange-rgb: 232, 89, 12;
        --green: #2b8a3e;
        --green-rgb: 43, 138, 62;
        --green-dim: #e3f5e8;
        --yellow: #b88200;
        --yellow-rgb: 184, 130, 0;
        --blue: #1971c2;
        --blue-rgb: 25, 113, 194;
        --mauve: #7048e8;
        --purple: #7048e8;
        --purple-rgb: 112, 72, 232;
        --pink: #c2255c;
      }
      :root:not(.dark):not(.light) .card { box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06); }
      :root:not(.dark):not(.light) .card.sev-critical {
        background: linear-gradient(90deg, rgba(var(--red-rgb), 0.08) 0%, transparent 22%), var(--bg-elev);
      }
    }

    /* ---- Theme toggle button ---- */
    .theme-toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 2rem;
      height: 2rem;
      padding: 0;
      background: var(--bg-elev);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-sm);
      color: var(--subtext);
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .theme-toggle:hover { background: var(--surface); color: var(--text); border-color: var(--blue); }
    .theme-toggle svg { width: 1rem; height: 1rem; }
    .theme-toggle .icon-moon { display: none; }
    :root.light .theme-toggle .icon-sun { display: none; }
    :root.light .theme-toggle .icon-moon { display: inline; }
    @media (prefers-color-scheme: light) {
      :root:not(.dark):not(.light) .theme-toggle .icon-sun { display: none; }
      :root:not(.dark):not(.light) .theme-toggle .icon-moon { display: inline; }
    }
    .header-right {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
    }

    html { scroll-behavior: smooth; }

    body {
      font-family: var(--font-sans);
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      padding: 2rem 1.25rem 4rem;
      line-height: 1.55;
      -webkit-font-smoothing: antialiased;
    }

    a { color: var(--blue); text-decoration: none; }
    a:hover { text-decoration: underline; }

    .layout {
      max-width: 1200px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: 240px minmax(0, 1fr);
      gap: 2.5rem;
    }

    @media (max-width: 900px) {
      .layout { grid-template-columns: 1fr; gap: 1.5rem; }
      .toc { position: static !important; }
    }

    /* ---- Header ---- */
    .page-header {
      grid-column: 1 / -1;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 1rem;
      padding-bottom: 1rem;
      margin-bottom: 1.5rem;
      border-bottom: 1px solid var(--border);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      font-family: var(--font-mono);
      font-size: 1rem;
      font-weight: 600;
      letter-spacing: 0.02em;
      color: var(--text);
    }
    .brand-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.5rem;
      height: 1.5rem;
      border-radius: 5px;
      background: var(--red-dim);
      color: var(--red);
    }
    .brand-sub {
      color: var(--muted);
      font-weight: 400;
      font-size: 0.85rem;
    }

    .header-meta {
      font-size: 0.8rem;
      color: var(--muted);
      font-family: var(--font-mono);
    }

    /* ---- Stat strip ---- */
    .stat-strip {
      grid-column: 1 / -1;
      display: grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 1px;
      background: var(--border);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      margin-bottom: 2rem;
    }
    @media (max-width: 700px) {
      .stat-strip { grid-template-columns: repeat(2, 1fr); }
    }
    .stat-cell {
      background: var(--bg-elev);
      padding: 0.85rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
    }
    .stat-cell-value {
      font-family: var(--font-mono);
      font-size: 1.5rem;
      font-weight: 700;
      color: var(--text);
      line-height: 1.1;
    }
    .stat-cell-value.stat-small { font-size: 1rem; padding-top: 0.4rem; }
    .stat-cell-value.stat-danger { color: var(--red); }
    .stat-cell-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
    }
    .stat-cell-desc {
      font-size: 0.7rem;
      color: var(--muted);
      line-height: 1.35;
      margin-top: 0.1rem;
      opacity: 0.85;
    }

    /* ---- TOC sidebar ---- */
    .toc {
      position: sticky;
      top: 1.5rem;
      align-self: start;
      max-height: calc(100vh - 3rem);
      overflow-y: auto;
    }
    .toc-heading {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--muted);
      margin-bottom: 0.5rem;
      padding: 0 0.5rem;
    }
    .toc-list {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }
    .toc-link {
      display: grid;
      grid-template-columns: 9px 1.25rem 1fr auto;
      align-items: center;
      gap: 0.5rem;
      padding: 0.45rem 0.5rem;
      border-radius: var(--radius-sm);
      color: var(--subtext);
      font-size: 0.82rem;
      line-height: 1.3;
      border-left: 2px solid transparent;
      transition: background 0.12s, border-color 0.12s, color 0.12s;
    }
    .toc-link:hover {
      background: var(--surface);
      color: var(--text);
      text-decoration: none;
      border-left-color: var(--blue);
    }
    .toc-sev {
      width: 9px;
      height: 9px;
      border-radius: 50%;
    }
    .toc-sev.sev-critical { background: var(--red); box-shadow: 0 0 6px rgba(var(--red-rgb), 0.7); }
    .toc-sev.sev-high { background: var(--coral); }
    .toc-sev.sev-medium { background: var(--orange); }
    .toc-sev.sev-low { background: var(--yellow); }
    .toc-num {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--muted);
    }
    .toc-name {
      font-family: var(--font-mono);
      font-size: 0.78rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .toc-fails {
      font-family: var(--font-mono);
      font-size: 0.72rem;
      color: var(--muted);
    }
    .toc-section {
      margin-top: 1rem;
      padding-top: 0.75rem;
      border-top: 1px solid var(--border);
    }
    .toc-section a {
      display: block;
      padding: 0.4rem 0.5rem;
      font-size: 0.78rem;
      color: var(--subtext);
      border-radius: var(--radius-sm);
    }
    .toc-section a:hover { background: var(--surface); color: var(--text); text-decoration: none; }

    .main-col { min-width: 0; }

    /* ---- Section titles ---- */
    .section-title {
      font-size: 0.8rem;
      font-weight: 600;
      color: var(--subtext);
      text-transform: uppercase;
      letter-spacing: 0.1em;
      margin-bottom: 0.85rem;
      padding-bottom: 0.5rem;
      border-bottom: 1px solid var(--border);
    }

    .patterns-title { margin-top: 0; }

    /* ---- Pattern card ---- */
    .card {
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-left: 4px solid var(--border-strong);
      border-radius: var(--radius);
      margin-bottom: 1rem;
      overflow: hidden;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .card:target {
      border-color: var(--blue);
      box-shadow: 0 0 0 1px var(--blue);
    }
    .card.sev-critical {
      border-left: 4px solid var(--red);
      background: linear-gradient(90deg, rgba(var(--red-rgb), 0.09) 0%, transparent 22%), var(--bg-elev);
    }
    .card.sev-high { border-left: 4px solid var(--coral); }
    .card.sev-medium { border-left: 4px solid var(--orange); }
    .card.sev-low { border-left: 4px solid var(--yellow); }

    .card-header {
      display: flex;
      gap: 1rem;
      padding: 0.9rem 1.1rem;
      align-items: flex-start;
    }
    .card-header-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .card-title-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      flex-wrap: wrap;
    }
    .sev-pill {
      font-size: 0.65rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 0.15rem 0.45rem;
      border-radius: 4px;
    }
    .sev-critical .sev-pill { background: rgba(var(--red-rgb), 0.22); color: var(--red); }
    .sev-high .sev-pill { background: rgba(var(--coral-rgb), 0.18); color: var(--coral); }
    .sev-medium .sev-pill { background: rgba(var(--orange-rgb), 0.16); color: var(--orange); }
    .sev-low .sev-pill { background: rgba(var(--yellow-rgb), 0.14); color: var(--yellow); }

    .card-num {
      font-family: var(--font-mono);
      font-size: 0.75rem;
      color: var(--muted);
    }
    .test-name {
      font-size: 0.95rem;
      font-weight: 600;
      font-family: var(--font-mono);
      color: var(--text);
      word-break: break-word;
      line-height: 1.4;
    }
    .card-file {
      font-size: 0.78rem;
      color: var(--muted);
    }
    .card-file code {
      font-family: var(--font-mono);
      color: var(--subtext);
    }

    .card-stats {
      flex-shrink: 0;
      text-align: right;
      display: flex;
      flex-direction: column;
      gap: 0.2rem;
      min-width: 120px;
    }
    .stat-main {
      display: flex;
      align-items: baseline;
      justify-content: flex-end;
      gap: 0.35rem;
    }
    .stat-value {
      font-family: var(--font-mono);
      font-size: 1.35rem;
      font-weight: 700;
      color: var(--text);
      line-height: 1;
    }
    .sev-critical .stat-value { color: var(--red); }
    .sev-high .stat-value { color: var(--coral); }
    .sev-medium .stat-value { color: var(--orange); }
    .stat-label {
      font-size: 0.7rem;
      color: var(--muted);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .stat-sub {
      font-size: 0.72rem;
      color: var(--muted);
      display: flex;
      gap: 0.35rem;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    .dot { color: var(--border-strong); }

    .card-error {
      display: flex;
      gap: 0.6rem;
      align-items: baseline;
      padding: 0.6rem 1.1rem;
      background: rgba(var(--red-rgb), 0.07);
      border-top: 1px solid var(--border);
      font-size: 0.8rem;
    }
    .error-prefix {
      flex-shrink: 0;
      font-size: 0.65rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--red);
      font-weight: 600;
      padding-top: 0.1rem;
    }
    .card-error code {
      font-family: var(--font-mono);
      color: var(--yellow);
      font-size: 0.78rem;
      word-break: break-word;
    }

    /* ---- Collapsed prompt ---- */
    .prompt-section {
      border-top: 1px solid var(--border);
    }
    .prompt-summary {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.55rem 1.1rem;
      font-size: 0.72rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      cursor: pointer;
      user-select: none;
      list-style: none;
      background: rgba(0, 0, 0, 0.15);
    }
    .prompt-summary::-webkit-details-marker { display: none; }
    .prompt-summary::before {
      content: '▶';
      display: inline-block;
      margin-right: 0.5rem;
      font-size: 0.6rem;
      color: var(--muted);
      transition: transform 0.15s;
    }
    details[open] .prompt-summary::before { transform: rotate(90deg); }
    .prompt-summary:hover { color: var(--subtext); background: rgba(0, 0, 0, 0.25); }
    .prompt-summary-label { color: var(--subtext); font-weight: 600; flex: 1; }
    .prompt-summary-hint {
      text-transform: none;
      letter-spacing: 0;
      font-size: 0.72rem;
      color: var(--muted);
    }
    .prompt-body {
      margin: 0;
      padding: 0.9rem 1.1rem 1.1rem;
      font-family: var(--font-mono);
      font-size: 0.78rem;
      line-height: 1.6;
      color: var(--subtext);
      white-space: pre-wrap;
      word-break: break-word;
      background: var(--bg);
      border-top: 1px solid var(--border);
      max-height: 420px;
      overflow: auto;
    }

    /* ---- Dashboard ---- */
    .dashboard-section {
      margin-top: 2.5rem;
      scroll-margin-top: 1rem;
    }

    .kind-cards {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
    }
    .kind-card {
      flex: 1 1 0;
      min-width: 160px;
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-left: 5px solid var(--border-strong);
      border-radius: var(--radius);
      padding: 0.9rem 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .kind-card-count {
      font-family: var(--font-mono);
      font-size: 1.75rem;
      font-weight: 700;
      line-height: 1;
    }
    .kind-card-label {
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      color: var(--subtext);
      font-weight: 600;
    }
    .kind-card-pct {
      font-size: 0.72rem;
      color: var(--muted);
      font-family: var(--font-mono);
    }

    /* ---- Tables ---- */
    .table-wrap {
      border: 1px solid var(--border);
      border-radius: var(--radius);
      overflow: hidden;
      background: var(--bg-elev);
    }
    .dash-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.82rem;
    }
    .dash-table th {
      text-align: left;
      color: var(--muted);
      font-size: 0.68rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 0.55rem 0.85rem;
      border-bottom: 1px solid var(--border);
      background: var(--surface);
      font-weight: 600;
    }
    .dash-table td {
      padding: 0.5rem 0.85rem;
      border-bottom: 1px solid var(--border);
    }
    .dash-table tbody tr:last-child td { border-bottom: none; }
    .dash-table tbody tr { transition: background 0.12s, box-shadow 0.12s; }
    .dash-table tbody tr:hover { background: var(--surface); box-shadow: inset 3px 0 0 var(--blue); }
    .dash-table code {
      font-family: var(--font-mono);
      font-size: 0.78rem;
      color: var(--blue);
    }
    .dash-table .num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      font-family: var(--font-mono);
    }
    .dash-table td.dim { color: var(--muted); }
    .dash-table .pass-num { color: var(--green); }
    .dash-table .fail-num { color: var(--red); }

    .status-badge {
      display: inline-block;
      padding: 0.05rem 0.5rem;
      border-radius: 4px;
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      background: transparent;
      border: 1px solid var(--border-strong);
      color: var(--muted);
    }
    .status-pass { border-color: var(--green); color: var(--green); background: rgba(var(--green-rgb), 0.12); }
    .status-fail { border-color: var(--red); color: var(--red); background: rgba(var(--red-rgb), 0.12); }
    .status-na { border-color: var(--border-strong); color: var(--muted); }

    /* ---- Copy buttons ---- */
    .prompt-summary-right {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
    }
    .copy-btn {
      font-family: var(--font-mono);
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 0.25rem 0.6rem;
      border: 1px solid var(--border-strong);
      background: var(--surface);
      color: var(--subtext);
      border-radius: 4px;
      cursor: pointer;
      transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .copy-btn:hover { background: var(--surface2); color: var(--text); border-color: var(--blue); }
    .copy-btn.copied { border-color: var(--green); color: var(--green); }
    .row-action { text-align: right; width: 1%; white-space: nowrap; }
    .visually-hidden {
      position: absolute;
      width: 1px; height: 1px;
      padding: 0; margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .muted { color: var(--muted); font-size: 0.85rem; }

    .footer {
      grid-column: 1 / -1;
      margin-top: 3rem;
      padding-top: 1.25rem;
      border-top: 1px solid var(--border);
      text-align: center;
      font-size: 0.78rem;
      color: var(--muted);
    }

    .empty {
      padding: 2rem;
      text-align: center;
      color: var(--muted);
      background: var(--bg-elev);
      border: 1px dashed var(--border);
      border-radius: var(--radius);
    }

    /* ---- Expandable run rows ---- */
    .run-row { cursor: pointer; }
    .run-row:hover { background: var(--surface); }
    .run-row:focus-visible { outline: 2px solid var(--blue); outline-offset: -2px; }
    .run-chevron-cell { width: 1.25rem; padding-right: 0 !important; }
    .run-chevron {
      width: 0.85rem;
      height: 0.85rem;
      color: var(--muted);
      transition: transform 0.12s ease-out;
      vertical-align: middle;
    }
    .run-row.expanded .run-chevron { transform: rotate(90deg); color: var(--blue); }
    .run-failures[hidden] { display: none; }
    .run-failures > td {
      background: var(--bg);
      padding: 0.75rem 1rem 0.9rem 2.25rem !important;
      border-top: 1px solid var(--border);
    }
    .run-failures-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.78rem;
      background: var(--bg-elev);
      border: 1px solid var(--border);
      border-radius: var(--radius-sm);
      overflow: hidden;
    }
    .run-failures-table th {
      text-align: left;
      color: var(--muted);
      font-size: 0.64rem;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      padding: 0.4rem 0.7rem;
      background: var(--surface);
      border-bottom: 1px solid var(--border);
      font-weight: 600;
    }
    .run-failures-table td {
      padding: 0.4rem 0.7rem;
      border-bottom: 1px solid var(--border);
      vertical-align: top;
    }
    .run-failures-table tbody tr:last-child td { border-bottom: none; }
    .run-failures-table code {
      font-family: var(--font-mono);
      font-size: 0.74rem;
      color: var(--text);
    }
    .run-fail-file {
      font-family: var(--font-mono);
      font-size: 0.68rem;
      color: var(--muted);
      margin-top: 0.15rem;
    }
    .run-fail-err {
      max-width: 38ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .run-fail-err code { color: var(--yellow); }
    .kind-badge {
      display: inline-block;
      padding: 0.05rem 0.4rem;
      border: 1px solid transparent;
      border-radius: 4px;
      font-size: 0.66rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      font-family: var(--font-mono);
    }
  </style>
</head>
<body>
  <div class="layout">
    <header class="page-header">
      <div class="brand">
        <span class="brand-mark">✗</span>
        <span>flaky-tests</span>
        <span class="brand-sub">report</span>
      </div>
      <div class="header-right">
        <div class="header-meta">window: ${windowDays}d &nbsp;·&nbsp; ${patterns.length} ${plural}</div>
        <button id="theme-toggle" class="theme-toggle" type="button" aria-label="Toggle theme">
          <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>
          <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
        </button>
      </div>
    </header>

    ${renderSummaryStats(patterns, dashboard, windowDays)}

    ${renderToc(patterns, Boolean(dashboard))}

    <main class="main-col">
      <h2 class="section-title patterns-title">Detected Patterns</h2>
      ${patterns.length === 0 ? '<div class="empty">No flaky patterns detected in this window.</div>' : cards}
      ${dashboard ? renderDashboard(dashboard, windowDays) : ''}
    </main>

    <footer class="footer">
      Generated by <a href="https://github.com/brewpirate/flaky-tests">flaky-tests</a>
      &nbsp;·&nbsp; click Copy on any card or use the disclosure to select-all manually
    </footer>
  </div>
  <!--
    Opt-in progressive enhancement: the report is fully usable without JS.
    This single inline block wires the Copy buttons; nothing else depends on it.
  -->
  <script>
    (function () {
      var toggle = document.getElementById('theme-toggle');
      if (toggle) {
        toggle.addEventListener('click', function () {
          var root = document.documentElement;
          var isLight = root.classList.contains('light');
          if (!isLight) {
            var prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
            var hasDark = root.classList.contains('dark');
            isLight = !hasDark && prefersLight;
          }
          if (isLight) {
            root.classList.remove('light');
            root.classList.add('dark');
            try { localStorage.setItem('flaky-theme', 'dark'); } catch (err) { /* ignore */ }
          } else {
            root.classList.remove('dark');
            root.classList.add('light');
            try { localStorage.setItem('flaky-theme', 'light'); } catch (err) { /* ignore */ }
          }
        });
      }
      var buttons = document.querySelectorAll('.copy-btn[data-prompt-id]');
      function flash(btn) {
        btn.classList.add('copied');
        btn.textContent = 'Copied ✓';
        setTimeout(function () {
          btn.classList.remove('copied');
          btn.textContent = btn.getAttribute('data-original') || 'Copy';
        }, 1500);
      }
      function fallbackSelect(node) {
        try {
          var range = document.createRange();
          range.selectNodeContents(node);
          var sel = window.getSelection();
          if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        } catch (err) { /* best-effort fallback */ }
      }
      buttons.forEach(function (btn) {
        btn.addEventListener('click', function (event) {
          event.preventDefault();
          event.stopPropagation();
          var id = btn.getAttribute('data-prompt-id');
          var target = id ? document.getElementById(id) : null;
          if (!target) return;
          var text = target.textContent || '';
          try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(function () { flash(btn); }, function () { fallbackSelect(target); });
            } else { fallbackSelect(target); }
          } catch (err) { fallbackSelect(target); }
        });
      });
      var runRows = document.querySelectorAll('.run-row[data-run-id]');
      function toggleRun(row) {
        var id = row.getAttribute('data-run-id');
        if (!id) return;
        var sibling = document.querySelector('.run-failures[data-run-id="' + id.replace(/"/g, '\\"') + '"]');
        if (!sibling) return;
        var isHidden = sibling.hasAttribute('hidden');
        if (isHidden) { sibling.removeAttribute('hidden'); row.classList.add('expanded'); }
        else { sibling.setAttribute('hidden', ''); row.classList.remove('expanded'); }
      }
      runRows.forEach(function (row) {
        row.addEventListener('click', function (event) {
          if (event.target && event.target.closest && event.target.closest('a')) return;
          toggleRun(row);
        });
        row.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggleRun(row); }
        });
      });
    })();
  </script>
</body>
</html>`
}
