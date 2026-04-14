# Codebase Audit — flaky-tests

> Consolidated findings from 10 expert agents. 2026-04-14.

---

## Critical Issues (fix before shipping)

### 1. Syntax Bug — missing closing brace in `check.ts`

**Found by:** CLI, TypeScript, Security, Architecture agents (4/10 flagged independently)

`packages/cli/src/check.ts` ~line 144: the `if (doCreateIssue)` block is missing its closing `}`, causing the `if (doHtml)` block to be nested inside it. Result: `--html` only works when `--create-issue` is also passed.

### 2. No build step — npm publishing is blocked

**Found by:** Build, CI/CD, Deployment agents

- Root `package.json` has no `build` script; `release.yml` calls `bun run build` which fails immediately
- All packages export raw `.ts` source files — npm consumers can't use them
- Missing `main`, `types`, `files`, `publishConfig` fields in every package.json
- `tsconfig.json` has `noEmit: true` — prevents any compilation output
- **This is the #1 shipping blocker.** The action.yml is entirely commented out waiting for CLI publication.

### 3. SQL injection via `tablePrefix`

**Found by:** Security agent

`store-postgres`, `store-supabase`, `store-turso` all accept a user-supplied `tablePrefix` that is interpolated into table names with zero validation. Add an allowlist regex: `/^[a-z_][a-z0-9_]*$/`.

### 4. Store behavioral inconsistency — `last_error_message`

**Found by:** Database, Architecture agents

| Store | `last_error_message` method | Correct? |
|---|---|---|
| SQLite | Timestamp-prefix MAX trick | Yes (most recent) |
| Turso | `MAX(error_message)` | No (lexicographic) |
| Postgres | `MAX() FILTER (WHERE ...)` | No (lexicographic) |
| Supabase | JS loop tracking `failed_at` | Yes (most recent) |

Two of four stores return the wrong error message for a flaky test.

---

## High Priority

### 5. Missing test coverage

**Found by:** Test agent

| Package | Tests? | Priority |
|---|---|---|
| core | categorize.test.ts | Covered |
| store-sqlite | index.test.ts | Covered |
| cli (prompt) | prompt.test.ts | Covered |
| cli (github, html, check) | None | **HIGH** |
| plugin-bun | None | **HIGH** |
| plugin-vitest | None | Medium |
| store-postgres | None | Medium |
| store-supabase | None | Medium |
| store-turso | None | Medium |

Anti-pattern found: `store-sqlite/src/index.test.ts` uses sync `expect().toThrow()` on an async function — assertion passes vacuously.

### 6. CI workflows broken/incomplete

**Found by:** CI/CD agent

- `release.yml` and `docs.yml` use `actions/checkout@v6` (doesn't exist — latest is v4)
- No typecheck step (`tsc --noEmit`)
- No lint step (no Biome/ESLint config)
- No internal CI workflow for the monorepo itself
- `flaky-check.yml` calls a no-op action

### 7. Missing `--help` and input validation in CLI

**Found by:** CLI agent

- No `--help` / `--version` flags
- `--window abc` silently produces `NaN`
- No progress indicators during network operations
- No `--dry-run` for `--create-issue`
- Clipboard on Linux silently fails without `xclip`

### 8. `IStore` interface gaps

**Found by:** Database, Architecture, TypeScript agents

- No `migrate()` / `init()` on interface — Turso requires manual `migrate()` call
- `reconcileRun()` exists only on SqliteStore, not on `IStore` — breaks store swapping in `run-tracked.ts`
- No bulk `insertFailures()` — each failure is a separate round-trip (bad for remote stores)
- `failureKinds: string[]` on `FlakyPattern` should be `FailureKind[]`
- `'pass' | 'fail'` literal union is inlined everywhere, never named

---

## Medium Priority

### 9. TypeScript rule violations

**Found by:** TypeScript agent

- **Unsafe casts**: `report.ts` uses `.all() as FlakyRow[]` (4 occurrences), `store-supabase` uses `as Row[]` — all unvalidated
- **Magic numbers**: `86400000` (ms/day), `TS_LEN = 25`, `.slice(0, 20)`, `.slice(0, 120)`, severity thresholds `10/5/2`
- **Abbreviations**: `esc(s)`, `patternCard(p, i, ...)`, `rows.map((r) => ...)`, `_t`, `_th`
- **Options objects**: `createIssue(config, pattern, windowDays)` has 3 params — needs `CreateIssueOpts`
- **Duplicate import**: `FlakyPattern` imported twice in `check.ts`

### 10. Missing database indexes

**Found by:** Database agent

- No index on `failures(failed_at)` — the core detection query does a full table scan
- No index on `runs(ended_at, failed_tests)` — join filter gets no index support
- Postgres and Supabase have no schema/DDL in code at all — users must provision manually

### 11. No transactions for run insertion

**Found by:** Database agent

`insertRun` + multiple `insertFailure` calls are not wrapped in a transaction in any store. A crash mid-run leaves orphaned partial data.

### 12. Duplicated logic across packages

**Found by:** Architecture, Database agents

- `captureGitInfo` is duplicated between `plugin-bun/src/git.ts` (uses `Bun.spawnSync`) and `plugin-vitest/src/index.ts` (uses `execSync`)
- Default values `windowDays ?? 7` and `threshold ?? 2` are copy-pasted in all 4 store implementations
- Detection query logic is reimplemented 4 times with subtle divergences

### 13. Documentation gaps

**Found by:** Docs agent

| Aspect | Rating |
|---|---|
| Root README | 8/10 |
| Docs site (Astro/Starlight) | 7.5/10 |
| Package READMEs | 3/10 (none exist) |
| API docs (TSDoc) | 5/10 (core good, rest bare) |
| Contributing guide | 1/10 (missing) |
| Migration guides | 2/10 (missing) |

### 14. `report.ts` doesn't close DB on error

**Found by:** TypeScript agent

`store-sqlite/src/report.ts` `loadData()` — if any query throws, `db.close()` is never reached. Needs try/finally.

### 15. Error messages may leak sensitive context

**Found by:** Security agent

`cli/src/github.ts` throws raw GitHub API response bodies on failure, which propagate to console output. Should truncate/sanitize.

---

## Low Priority

- `--repo` value from `process.argv` not validated for safe characters
- `getDb()` exposed publicly on `SqliteStore` breaks encapsulation
- No connection pooling configuration exposed for Postgres
- No retry logic on transient errors for any remote store
- Detection algorithm only catches *newly* flaky tests; always-flaky tests are invisible
- `failed_tests < 10` filter is hardcoded with no override
- `packages/docs` should be `"private": true` (already is)

---

## Recommended Implementation Order

1. **Fix the `check.ts` brace bug** — 5 min, prevents user-facing breakage
2. **Validate `tablePrefix`** — 10 min, security fix
3. **Fix `last_error_message` in Turso and Postgres stores** — correctness
4. **Add build infrastructure** — unblocks npm publishing and the GitHub Action
5. **Fix CI workflows** — checkout@v4, add typecheck + test steps
6. **Add `--help`, input validation to CLI** — adoption blocker
7. **Extract shared defaults and types to core** — reduce duplication
8. **Add `migrate()` to `IStore`** — consistency across backends
9. **Write tests for github.ts, html.ts, plugin-bun** — highest-risk untested code
10. **Add missing indexes** — performance at scale
11. **Package READMEs + CONTRIBUTING.md** — npm presence
12. **Wrap run insertion in transactions** — data integrity
