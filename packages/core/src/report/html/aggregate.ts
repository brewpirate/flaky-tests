import type { FailureRow } from '../../types'
import type { HotFile, KindBreakdown, RunFailure } from './types'

/**
 * Options for {@link aggregateDashboard}. `hotFileLimit` caps the "hot files"
 * list so the report stays scannable even on very large repos.
 */
export interface AggregateDashboardOptions {
  hotFileLimit: number
}

/**
 * Folded dashboard data produced from a flat list of {@link FailureRow}s.
 * Matches what the HTML renderer expects on top of patterns + recent runs.
 */
export interface AggregatedDashboard {
  kindBreakdown: KindBreakdown[]
  hotFiles: HotFile[]
  failuresByRun: Map<string, RunFailure[]>
}

/**
 * Group raw failure rows into the three views the HTML report needs:
 * failures-per-kind, hottest files (by distinct tests + totals), and
 * per-run failure lists for the expandable drill-downs.
 *
 * Aggregation lives here — and only here — so every store adapter produces
 * the same bytes and the grouping logic stays in one place.
 */
export function aggregateDashboard(
  failures: readonly FailureRow[],
  options: AggregateDashboardOptions,
): AggregatedDashboard {
  const kindCounts = new Map<string, number>()
  const hotFileMap = new Map<string, { fails: number; tests: Set<string> }>()
  const failuresByRun = new Map<string, RunFailure[]>()

  for (const row of failures) {
    kindCounts.set(row.failureKind, (kindCounts.get(row.failureKind) ?? 0) + 1)

    let fileEntry = hotFileMap.get(row.testFile)
    if (!fileEntry) {
      fileEntry = { fails: 0, tests: new Set() }
      hotFileMap.set(row.testFile, fileEntry)
    }
    fileEntry.fails++
    fileEntry.tests.add(row.testName)

    let bucket = failuresByRun.get(row.runId)
    if (!bucket) {
      bucket = []
      failuresByRun.set(row.runId, bucket)
    }
    bucket.push({
      testName: row.testName,
      testFile: row.testFile,
      failureKind: row.failureKind,
      errorMessage: row.errorMessage,
      failedAt: row.failedAt,
    })
  }

  const kindBreakdown: KindBreakdown[] = [...kindCounts.entries()]
    .map(([failureKind, count]) => ({ failureKind, count }))
    .sort((a, b) => b.count - a.count)

  const hotFiles: HotFile[] = [...hotFileMap.entries()]
    .map(([testFile, entry]) => ({
      testFile,
      fails: entry.fails,
      distinctTests: entry.tests.size,
    }))
    .sort((a, b) => b.fails - a.fails)
    .slice(0, options.hotFileLimit)

  return { kindBreakdown, hotFiles, failuresByRun }
}
