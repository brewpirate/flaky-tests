/**
 * GitHub REST API helpers for issue creation.
 * Uses native fetch — no external dependencies.
 */

// biome-ignore-all lint/suspicious/noConsole: CLI tool

import type { FlakyPattern } from '@flaky-tests/core'
import { generatePrompt } from './prompt'

/** Authentication and target repository for GitHub API calls. */
export interface GitHubConfig {
  token: string
  owner: string
  repo: string
}

const FETCH_TIMEOUT_MS = 15_000
const MAX_ISSUE_BODY_CHARS = 60_000
const OWNER_REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

function isValidSlug(value: string): boolean {
  return OWNER_REPO_PATTERN.test(value)
}

/**
 * Resolve owner/repo from:
 *   1. GITHUB_REPOSITORY env var (set automatically in Actions)
 *   2. --repo <owner/repo> CLI flag
 *   3. git remote origin URL (fallback for local runs)
 *
 * Validates both owner and repo against GitHub's slug format. Returns null
 * if no valid source is available.
 */
export function resolveRepo(): { owner: string; repo: string } | null {
  const envRepo = process.env.GITHUB_REPOSITORY
  if (envRepo) {
    const parts = envRepo.split('/')
    const owner = parts[0]
    const repo = parts[1]
    if (owner && repo && isValidSlug(owner) && isValidSlug(repo)) {
      return { owner, repo }
    }
  }

  const index = process.argv.indexOf('--repo')
  if (index !== -1 && index + 1 < process.argv.length) {
    const value = process.argv[index + 1]
    if (value) {
      const parts = value.split('/')
      const owner = parts[0]
      const repo = parts[1]
      if (owner && repo && isValidSlug(owner) && isValidSlug(repo)) {
        return { owner, repo }
      }
    }
  }

  try {
    const result = Bun.spawnSync({
      cmd: ['git', 'remote', 'get-url', 'origin'],
      stdout: 'pipe',
      stderr: 'ignore',
    })
    if (result.exitCode === 0) {
      const url = new TextDecoder().decode(result.stdout).trim()
      const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
      if (match) {
        const owner = match[1]
        const repo = match[2]
        if (owner && repo && isValidSlug(owner) && isValidSlug(repo)) {
          return { owner, repo }
        }
      }
    }
  } catch {
    // git not available
  }

  return null
}

function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'flaky-tests-cli',
  }
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Search GitHub for an already-open issue matching a flaky test's title
 * (`[flaky-test] <testName>`). Used by `check.ts --create-issue` to avoid
 * filing duplicates on every run.
 *
 * Returns `null` on any search failure (non-2xx, malformed JSON, network
 * error) rather than throwing — a failed search should not block issue
 * creation, since the worst case is a duplicate issue that humans can close.
 *
 * @param config - GitHub authentication and target repository
 * @param testName - Unescaped test name; the function builds and URL-encodes the search query
 */
export async function findExistingIssue(
  config: GitHubConfig,
  testName: string,
): Promise<number | null> {
  const title = issueTitle(testName)
  const query = encodeURIComponent(
    `repo:${config.owner}/${config.repo} is:issue is:open "${title}" in:title`,
  )
  const response = await fetchWithTimeout(
    `https://api.github.com/search/issues?q=${query}&per_page=1`,
    { headers: githubHeaders(config.token) },
  )
  if (!response.ok) {
    return null
  }
  const data = (await response.json()) as { items?: Array<{ number: number }> }
  return data.items?.[0]?.number ?? null
}

/**
 * File a new GitHub issue for a flaky test pattern. The body embeds an
 * investigation prompt from {@link generatePrompt} inside a collapsible
 * details block, plus a labeled summary (`flaky-test` label) so teams can
 * filter on it.
 *
 * Unlike {@link findExistingIssue}, this function throws on API failure —
 * the caller in `check.ts` catches each throw per-pattern so one bad
 * request does not abort the rest of the batch.
 *
 * @param config - GitHub authentication and target repository
 * @param pattern - The flaky test pattern being reported
 * @param windowDays - Detection window size, surfaced in the issue body
 * @returns The `html_url` of the created issue
 * @throws `Error` with `GitHub API error <status>: <body>` on non-2xx
 * @throws `Error` `GitHub API returned no html_url` if the response body
 * is missing the expected field
 */
export async function createIssue(
  config: GitHubConfig,
  pattern: FlakyPattern,
  windowDays: number,
): Promise<string> {
  const body = issueBody(pattern, windowDays)
  const response = await fetchWithTimeout(
    `https://api.github.com/repos/${config.owner}/${config.repo}/issues`,
    {
      method: 'POST',
      headers: githubHeaders(config.token),
      body: JSON.stringify({
        title: issueTitle(pattern.testName),
        body,
        labels: ['flaky-test'],
      }),
    },
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(
      `GitHub API error ${response.status}: ${text.slice(0, 500)}`,
    )
  }

  const data = (await response.json()) as { html_url?: string }
  if (typeof data.html_url !== 'string') {
    throw new Error('GitHub API returned no html_url')
  }
  return data.html_url
}

function issueTitle(testName: string): string {
  return `[flaky-test] ${testName}`
}

function issueBody(pattern: FlakyPattern, windowDays: number): string {
  const prompt = generatePrompt(pattern, windowDays)

  const body = `## Flaky test detected

**Test:** \`${pattern.testName}\`
**File:** \`${pattern.testFile}\`
**Failures (last ${windowDays} days):** ${pattern.recentFails}
**Kind:** ${pattern.failureKinds.join(', ')}
${pattern.lastErrorMessage ? `**Last error:** ${pattern.lastErrorMessage.split('\n')[0]}` : ''}

<details>
<summary>Investigation prompt — copy to AI assistant</summary>

\`\`\`
${prompt}
\`\`\`

</details>

---
*Detected by [flaky-tests](https://github.com/brewpirate/flaky-tests)*`

  return body.length > MAX_ISSUE_BODY_CHARS
    ? `${body.slice(0, MAX_ISSUE_BODY_CHARS)}\n\n…_(truncated)_`
    : body
}
