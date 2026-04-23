/**
 * Cross-cutting helpers shared by the pattern, dashboard, and shell renderers.
 *
 * Kept small on purpose: pure functions with no template fragments. Anything
 * that emits HTML belongs in its owning renderer module.
 */

/** Minimal HTML-entity escape for user-controlled strings (test names, file
 *  paths, error messages) that get interpolated into the single-file report. */
export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Buckets a recent-failure count into the four visual severity tiers that
 *  drive card accents, TOC dots, and pill colors throughout the report. */
export const SEVERITY_CRITICAL_THRESHOLD = 10
export const SEVERITY_HIGH_THRESHOLD = 5
export const SEVERITY_MEDIUM_THRESHOLD = 2
export const MAX_VISIBLE_PATH_SEGMENTS = 3

export function severityRank(recentFails: number): {
  label: string
  className: string
} {
  if (recentFails >= SEVERITY_CRITICAL_THRESHOLD) {
    return { label: 'critical', className: 'sev-critical' }
  }
  if (recentFails >= SEVERITY_HIGH_THRESHOLD) {
    return { label: 'high', className: 'sev-high' }
  }
  if (recentFails >= SEVERITY_MEDIUM_THRESHOLD) {
    return { label: 'medium', className: 'sev-medium' }
  }
  return { label: 'low', className: 'sev-low' }
}

/** Collapses deep repo paths to the last three segments so card headers stay
 *  scannable without losing the locating suffix. */
export function shortFile(path: string): string {
  const parts = path.split('/')
  if (parts.length <= MAX_VISIBLE_PATH_SEGMENTS) {
    return path
  }
  return `…/${parts.slice(-MAX_VISIBLE_PATH_SEGMENTS).join('/')}`
}

const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE
const MINUTES_PER_HOUR = 60
const HOURS_PER_DAY = 24
const SHORT_SHA_LENGTH = 7
export const PERCENT_SCALE = 100

/** Formats a millisecond duration as a compact human string. */
export function formatDuration(ms: number | null): string {
  if (ms == null) {
    return '—'
  }
  if (ms < MS_PER_SECOND) {
    return `${ms}ms`
  }
  const s = ms / MS_PER_SECOND
  if (s < SECONDS_PER_MINUTE) {
    return `${s.toFixed(1)}s`
  }
  const m = Math.floor(s / SECONDS_PER_MINUTE)
  const rem = Math.round(s % SECONDS_PER_MINUTE)
  return `${m}m ${rem}s`
}

/** Humanizes an ISO timestamp as a coarse "x ago" string — the report is
 *  read asynchronously so exact times are noise. */
export function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / MS_PER_MINUTE)
  if (mins < 1) {
    return 'just now'
  }
  if (mins < MINUTES_PER_HOUR) {
    return `${mins}m ago`
  }
  const hrs = Math.floor(mins / MINUTES_PER_HOUR)
  if (hrs < HOURS_PER_DAY) {
    return `${hrs}h ago`
  }
  const days = Math.floor(hrs / HOURS_PER_DAY)
  return `${days}d ago`
}

/** Truncates a git SHA to the conventional 7-char display form, with an
 *  em-dash placeholder when the run has no recorded commit. */
export function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, SHORT_SHA_LENGTH) : '—'
}

/** Maps a failure category to a themed CSS variable so assertions, timeouts,
 *  and uncaught errors are visually distinct at a glance. */
export function kindColor(kind: string): string {
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
export function kindRgb(kind: string): string {
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
export function failColor(n: number): string {
  if (n >= SEVERITY_CRITICAL_THRESHOLD) {
    return 'var(--red)'
  }
  if (n >= SEVERITY_HIGH_THRESHOLD) {
    return 'var(--yellow)'
  }
  if (n >= SEVERITY_MEDIUM_THRESHOLD) {
    return 'var(--text)'
  }
  return 'var(--green)'
}
