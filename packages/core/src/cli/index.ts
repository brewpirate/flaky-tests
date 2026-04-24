/**
 * CLI programmatic surface for `flaky-tests`.
 *
 * The `flaky-tests` bin (shipped in `@flaky-tests/core`) orchestrates
 * pattern detection → AI investigation prompt → HTML report → GitHub
 * issue creation. This module exposes each piece as a programmatic API
 * so downstream tools can compose them without shelling out to the
 * binary: HTML report generation (`generateHtml`, `aggregateDashboard`),
 * GitHub issue operations (`createIssue`, `findExistingIssue`,
 * `resolveRepo`), and prompt generation / clipboard helpers
 * (`generatePrompt`, `copyToClipboard`).
 *
 * @module
 */
export {
  type AggregateDashboardOptions,
  type AggregatedDashboard,
  aggregateDashboard,
  generateHtml,
} from '../report/html'
export type { GitHubConfig } from './github'
export { createIssue, findExistingIssue, resolveRepo } from './github'
export { copyToClipboard, generatePrompt } from './prompt'
