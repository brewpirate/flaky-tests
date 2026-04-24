# CLAUDE.md

## Project overview

flaky-tests is a TypeScript monorepo for detecting flaky tests. It captures failures from Bun or Vitest into pluggable storage backends, detects newly-flaky patterns by comparing failure counts across time windows, generates AI investigation prompts, and opens GitHub issues.

## Build & run

```sh
bun install          # install all workspace dependencies
bun test             # run unit tests (integration tests skipped)
bun run test:integration  # run integration tests (needs databases)
bun run test:all     # run everything
bun run build        # build all packages
```

Docs site (Astro + Starlight):
```sh
cd docs && bun run dev      # local dev server
cd docs && bun run build    # production build
```

## Monorepo structure

- `packages/core` — `IStore` interface, shared types, error categorization helpers, and the detection CLI (`flaky-tests` bin, prompt generation) under `src/cli/`
- `packages/plugin-bun` — Bun test preload, captures failures via `bun:sqlite`
- `packages/plugin-vitest` — Vitest reporter implementing `onInit`/`onFinished`
- `packages/store-sqlite` — Local SQLite store (uses `bun:sqlite`, WAL mode)
- `packages/store-turso` — Remote Turso/libSQL store
- `packages/store-supabase` — Supabase store
- `packages/store-postgres` — PostgreSQL/Neon store
- `docs/` — Starlight documentation site (at repo root, outside `packages/`)

Dependency order: core → stores → plugins (CLI lives inside core)

## Key architecture

- **IStore interface** (`packages/core/src/types.ts`) — all stores implement `insertRun`, `updateRun`, `insertFailure`, `insertFailures`, `getNewPatterns`, `close`
- **ArkType schemas** (`packages/core/src/schemas.ts`) — single source of truth for all data types; runtime validation at both plugin and store boundaries
- **Pattern detection** — compares failure counts in two equal time windows; flags tests with ≥threshold recent failures and zero prior failures; filters out runs where ≥10 tests failed (infra blowups)
- **Two-phase run recording** — `insertRun()` at start, `updateRun()` at completion
- **AI prompts** (`packages/core/src/prompt.ts`) — `generatePrompt()` shared by CLI and HTML report

## Testing

Tests use Bun's built-in test runner. Two tiers:

**Unit tests** (`bun test`) — run on every commit, no external deps:
- `packages/core/src/*.test.ts` — schemas, validation, escaping, git, errors, prompt, pattern mapper
- `packages/core/src/cli/**/*.test.ts` — CLI args, prompt generation, GitHub API, HTML report
- `packages/plugin-vitest/src/index.test.ts` — reporter lifecycle with mock store
- `packages/plugin-bun/src/*.test.ts` — preload store contract, git capture
- `packages/store-sqlite/src/index.test.ts` — full store + pattern detection

**Integration tests** (`bun run test:integration`) — skipped by default, run on main push:
- `packages/store-turso/src/index.integration.test.ts` — uses `file::memory:`
- `packages/store-postgres/src/index.integration.test.ts` — needs Docker Postgres
- `packages/store-supabase/src/index.integration.test.ts` — needs Supabase secrets

Integration tests are guarded by `describe.skipIf(!process.env.INTEGRATION)`.

## CI/CD

- `ci.yml` — unit tests on push to main and all PRs
- `integration.yml` — integration tests on push to main + manual trigger (Postgres via Docker, Turso in-memory, Supabase via secrets)
- `flaky-check.yml` — scheduled detection (Monday 9am UTC) + manual trigger
- `docs.yml` — deploys docs to GitHub Pages when `docs/**` changes
- `release.yml` — changesets-driven npm publish + GitHub Release

## GitHub Action

`action.yml` at root. Currently stubbed (echoes warning) — waiting for CLI npm publish before enabling full action steps.

## Code conventions

See `.claude/rules/` for detailed style rules. Key points:
- Strict TypeScript, ESNext target, bundler module resolution
- Files: kebab-case for `.ts`, PascalCase for `.tsx`
- No abbreviations (`config` not `cfg`, `context` not `ctx`)
- No TODOs/FIXMEs in delivered code
- No `process.env` access in app code — use config
- Extract at 3+ repetitions (DRY)
- Thin routes, business logic in services
