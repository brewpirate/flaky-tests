# Expert Agents for flaky-tests

> Top 10 agents ranked by impact for improving this project.

| # | Agent | Why it fits |
|---|---|---|
| **1** | `voltagent-lang:typescript-pro` | Core of the project — all packages are TypeScript. Advanced type patterns, the `IStore` interface, generics across store adapters, and end-to-end type safety across the monorepo would benefit heavily. |
| **2** | `voltagent-qa-sec:test-automator` | Ironic for a flaky-test detector: this repo has very few tests itself (only `prompt.test.ts`, `categorize.test.ts`, `index.test.ts`). Needs a comprehensive test suite across all 9 packages. |
| **3** | `voltagent-infra:devops-engineer` | 4 GitHub Actions workflows (CI, docs, release, flaky-check), the action.yml is disabled with TODOs, and the release pipeline needs work to actually publish to npm. |
| **4** | `voltagent-dev-exp:cli-developer` | The `@flaky-tests/cli` package is the primary user interface — command design, argument parsing, output formatting, and cross-platform compatibility matter a lot for adoption. |
| **5** | `voltagent-qa-sec:code-reviewer` | Multi-package repo with DB adapters, git integration, GitHub API calls — a thorough review would catch security issues (connection string handling, token leaks) and code quality gaps. |
| **6** | `voltagent-data-ai:database-optimizer` | 4 store backends (SQLite, Turso, Supabase, Postgres) all doing windowed queries for flaky detection. Query optimization and schema design directly affect detection accuracy and performance. |
| **7** | `voltagent-dev-exp:build-engineer` | Bun workspace monorepo needs proper build orchestration, package publishing pipeline, and ensuring the 9 packages build/link correctly for npm release. |
| **8** | `voltagent-dev-exp:documentation-engineer` | Has a docs package (Astro/Starlight), README links to docs site. Needs API docs, store setup guides, and migration docs as the project approaches v1. |
| **9** | `voltagent-infra:deployment-engineer` | The release.yml workflow + npm publishing pipeline is critical — the action.yml is blocked on `@flaky-tests/cli` being published. Unblocking this is the #1 shipping blocker. |
| **10** | `voltagent-qa-sec:architect-reviewer` | The `IStore` abstraction, plugin architecture (preload hooks vs reporters), and the detection algorithm design could benefit from an architectural review before v1 locks in the public API. |

## Key Observation

The single biggest blocker is that the CLI isn't published to npm yet (`action.yml` is entirely commented out). Agents **#7** (build) and **#9** (deployment) together would unblock shipping. Agent **#2** (test-automator) is especially fitting given the project's own mission is about test reliability.
