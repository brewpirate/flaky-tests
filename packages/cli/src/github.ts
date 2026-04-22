/**
 * GitHub REST API helpers for issue creation.
 * Uses native fetch — no external dependencies.
 */

// biome-ignore-all lint/suspicious/noConsole: CLI tool

import type { FlakyPattern } from '@flaky-tests/core'
import { createLogger } from '@flaky-tests/core'
import { type } from 'arktype'
import { generatePrompt } from './prompt'

const log = createLogger('cli:github')

/** Default network timeout for GitHub API calls. */
const FETCH_TIMEOUT_MS = 15_000

/** Max characters for an issue body — GitHub's documented hard limit is 65536. */
const MAX_ISSUE_BODY_CHARS = 60_000

/** Max characters echoed from an error response body — guards against leaking secrets via error messages. */
const MAX_ERROR_BODY_CHARS = 500

/**
 * Valid GitHub owner/repo slug. Prevents path injection in
 * `/repos/${owner}/${repo}/issues` — without validation, a crafted
 * --repo argument could rewrite the request path.
 */
const OWNER_REPO_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

function isValidSlug(value: string): boolean {
  return OWNER_REPO_PATTERN.test(value)
}

/** Fetch with an AbortSignal-based timeout. Rejects on timeout with a clear message. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`GitHub request timed out after ${timeoutMs}ms: ${url}`)
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

/** Authentication and target repository for GitHub API calls. */
export const gitHubConfigSchema = type({
  token: type.string.atLeastLength(1),
  owner: type.string.atLeastLength(1),
  repo: type.string.atLeastLength(1),
})

/** Validated GitHub API credentials and repository target. */
export type GitHubConfig = typeof gitHubConfigSchema.infer

/**
 * Resolve owner/repo from:
 *   1. GITHUB_REPOSITORY env var (set automatically in Actions)
 *   2. --repo <owner/repo> CLI flag
 *   3. git remote origin URL (fallback for local runs)
 */
export function resolveRepo(): { owner: string; repo: string } | null {
  // GitHub Actions sets this automatically
  const envRepo = process.env.GITHUB_REPOSITORY
  if (envRepo) {
    const [owner, repo] = envRepo.split('/')
    if (owner && repo && isValidSlug(owner) && isValidSlug(repo)) {
      log.debug(
        `resolveRepo: source=GITHUB_REPOSITORY, owner=${owner}, repo=${repo}`,
      )
      return { owner, repo }
    }
  }

  // --repo flag
  const index = process.argv.indexOf('--repo')
  if (index !== -1 && index + 1 < process.argv.length) {
    const value = process.argv[index + 1]
    if (!value) return null
    const [owner, repo] = value.split('/')
    if (owner && repo && isValidSlug(owner) && isValidSlug(repo)) {
      log.debug(`resolveRepo: source=--repo flag, owner=${owner}, repo=${repo}`)
      return { owner, repo }
    }
  }

  // Parse git remote
  try {
    const result = Bun.spawnSync({
      cmd: ['git', 'remote', 'get-url', 'origin'],
      stdout: 'pipe',
      stderr: 'ignore',
    })
    if (result.exitCode === 0) {
      const url = new TextDecoder().decode(result.stdout).trim()
      // https://github.com/owner/repo.git  or  git@github.com:owner/repo.git
      const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/)
      const owner = match?.[1]
      const repo = match?.[2]
      if (owner && repo && isValidSlug(owner) && isValidSlug(repo)) {
        log.debug(
          `resolveRepo: source=git remote, owner=${owner}, repo=${repo}`,
        )
        return { owner, repo }
      }
    }
  } catch {
    // git not available
  }

  log.debug(
    'resolveRepo: all sources failed (GITHUB_REPOSITORY, --repo flag, git remote)',
  )

  return null
}

/** Standard header bundle for GitHub's REST v3 API — pinned API version
 *  shields us from silent behavior changes when GitHub rolls a new default. */
function githubHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'flaky-tests-cli',
  }
}

/** Returns the issue number if an open issue for this test already exists. */
export async function findExistingIssue(
  config: GitHubConfig,
  testName: string,
): Promise<number | null> {
  const title = issueTitle(testName)
  const q = encodeURIComponent(
    `repo:${config.owner}/${config.repo} is:issue is:open "${title}" in:title`,
  )
  const start = performance.now()
  const res = await fetchWithTimeout(
    `https://api.github.com/search/issues?q=${q}&per_page=1`,
    {
      headers: githubHeaders(config.token),
    },
  )
  log.debug(
    `findExistingIssue: ${res.status} in ${Math.round(performance.now() - start)}ms (testName=${testName})`,
  )
  if (!res.ok) return null
  const data = (await res.json()) as { items: Array<{ number: number }> }
  return data.items[0]?.number ?? null
}

/** Create a GitHub issue for a flaky pattern. Returns the issue URL. */
export async function createIssue(
  config: GitHubConfig,
  pattern: FlakyPattern,
  windowDays: number,
): Promise<string> {
  if (!isValidSlug(config.owner) || !isValidSlug(config.repo)) {
    throw new Error(`Invalid owner/repo slug: ${config.owner}/${config.repo}`)
  }
  const rawBody = issueBody(pattern, windowDays)
  const body =
    rawBody.length > MAX_ISSUE_BODY_CHARS
      ? `${rawBody.slice(0, MAX_ISSUE_BODY_CHARS)}\n\n…(truncated)`
      : rawBody
  if (rawBody.length > MAX_ISSUE_BODY_CHARS) {
    log.debug(
      `createIssue: body truncated from ${rawBody.length} to ${MAX_ISSUE_BODY_CHARS} chars`,
    )
  }
  const start = performance.now()
  const res = await fetchWithTimeout(
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
  log.debug(
    `createIssue: ${res.status} in ${Math.round(performance.now() - start)}ms (testName=${pattern.testName})`,
  )

  if (!res.ok) {
    const text = (await res.text()).slice(0, MAX_ERROR_BODY_CHARS)
    throw new Error(`GitHub API error ${res.status}: ${text}`)
  }

  const data = (await res.json()) as { html_url: string }
  return data.html_url
}

/** Deterministic issue title so the duplicate-detection search is an
 *  exact-title match rather than fuzzy keyword lookup. */
function issueTitle(testName: string): string {
  return `[flaky-test] ${testName}`
}

/** Renders the issue body: the investigation prompt in a code block so
 *  reviewers can paste it straight into an AI assistant. */
function issueBody(pattern: FlakyPattern, windowDays: number): string {
  const prompt = generatePrompt(pattern, windowDays)

  return `## Flaky test detected

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
}
