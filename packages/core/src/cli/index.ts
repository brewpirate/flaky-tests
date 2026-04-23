export {
  type AggregateDashboardOptions,
  type AggregatedDashboard,
  aggregateDashboard,
  generateHtml,
} from '../report/html'
export type { GitHubConfig } from './github'
export { createIssue, findExistingIssue, resolveRepo } from './github'
export { copyToClipboard, generatePrompt } from './prompt'
