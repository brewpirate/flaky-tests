/**
 * Dashboard aggregate types consumed by the HTML report.
 *
 * Produced in-process by `aggregateDashboard()` (core) from raw
 * {@link FailureRow} rows returned by {@link IStore.listFailures}. These
 * types are renderer-local — the IStore contract exposes only the raw row
 * primitive; aggregation lives here so every adapter produces one shape.
 */

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
