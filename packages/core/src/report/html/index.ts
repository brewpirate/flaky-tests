import type { FlakyPattern } from '#core'
import {
  type DashboardData,
  renderDashboard,
  renderSummaryStats,
  renderToc,
} from './render-dashboard'
import { renderPatterns } from './render-patterns'
import { renderShell } from './render-shell'

export {
  type AggregateDashboardOptions,
  type AggregatedDashboard,
  aggregateDashboard,
} from './aggregate'
export type { HotFile, KindBreakdown, RecentRun, RunFailure } from './types'

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
  dashboard?: DashboardData,
): string {
  return renderShell(
    {
      statStrip: renderSummaryStats(patterns, dashboard, windowDays),
      toc: renderToc(patterns, Boolean(dashboard)),
      patterns: renderPatterns(patterns, windowDays),
      dashboard: dashboard ? renderDashboard(dashboard, windowDays) : '',
    },
    { patternCount: patterns.length, windowDays },
  )
}
