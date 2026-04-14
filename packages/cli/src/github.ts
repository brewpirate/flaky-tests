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
    if (owner && repo) return { owner, repo }
  }

  // --repo flag
  const idx = process.argv.indexOf('--repo')
  if (idx !== -1 && idx + 1 < process.argv.length) {
    const val = process.argv[idx + 1]!
    const [owner, repo] = val.split('/')
    if (owner && repo) return { owner, repo }
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
      if (match) return { owner: match[1]!, repo: match[2]! }
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

/** Returns the issue number if an open issue for this test already exists. */
export async function findExistingIssue(
  config: GitHubConfig,
  testName: string,
): Promise<number | null> {
  const title = issueTitle(testName)
  const q = encodeURIComponent(
    `repo:${config.owner}/${config.repo} is:issue is:open "${title}" in:title`,
  )
  const res = await fetch(`https://api.github.com/search/issues?q=${q}&per_page=1`, {
    headers: githubHeaders(config.token),
  })
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
  const res = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/issues`,
    {
      method: 'POST',
      headers: githubHeaders(config.token),
      body: JSON.stringify({
        title: issueTitle(pattern.testName),
        body: issueBody(pattern, windowDays),
        labels: ['flaky-test'],
      }),
    },
  )

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`GitHub API error ${res.status}: ${text}`)
  }

  const data = (await res.json()) as { html_url: string }
  return data.html_url
}

function issueTitle(testName: string): string {
  return `[flaky-test] ${testName}`
}

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
