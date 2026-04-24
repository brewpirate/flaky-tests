import type { FlakyPattern } from '#core'
import { generatePrompt } from '#core'
import { escapeHtml as esc } from '../html-utils'
import { severityRank, shortFile } from './utils'

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

/** Renders the full list of pattern cards, or the empty-state placeholder
 *  when no patterns qualified. */
export function renderPatterns(
  patterns: FlakyPattern[],
  windowDays: number,
): string {
  if (patterns.length === 0) {
    return '<div class="empty">No flaky patterns detected in this window.</div>'
  }
  return patterns.map((p, i) => patternCard(p, i, windowDays)).join('\n')
}
