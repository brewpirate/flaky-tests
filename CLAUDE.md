# CLAUDE.md

## Project overview

flaky-tests is a TypeScript monorepo for detecting flaky tests. It captures failures from Bun or Vitest into pluggable storage backends, detects newly-flaky patterns by comparing failure counts across time windows, generates AI investigation prompts, and opens GitHub issues.

## Build & run

```sh
bun install        # install all workspace dependencies
bun test           # run all tests across packages
```

Docs site (Astro + Starlight):
```sh
cd packages/docs && bun run dev      # local dev server
cd packages/docs && bun run build    # production build
```

No explicit build step for library packages — they ship TypeScript source directly.

## Monorepo structure

- `packages/core` — `IStore` interface, shared types, error categorization helpers
- `packages/cli` — Detection CLI (`flaky-tests` bin), prompt generation
- `packages/plugin-bun` — Bun test preload, captures failures via `bun:sqlite`
- `packages/plugin-vitest` — Vitest reporter implementing `onInit`/`onFinished`
- `packages/store-sqlite` — Local SQLite store (uses `bun:sqlite`, WAL mode)
- `packages/store-turso` — Remote Turso/libSQL store
- `packages/store-supabase` — Supabase store
- `packages/store-postgres` — PostgreSQL/Neon store
- `packages/docs` — Starlight documentation site

Dependency order: core → stores → plugins → cli

## Key architecture

- **IStore interface** (`packages/core/src/types.ts`) — all stores implement `insertRun`, `updateRun`, `insertFailure`, `getNewPatterns`, `close`
- **Pattern detection** — compares failure counts in two equal time windows; flags tests with ≥threshold recent failures and zero prior failures; filters out runs where ≥10 tests failed (infra blowups)
- **Two-phase run recording** — `insertRun()` at start, `updateRun()` at completion

## Testing

Tests use Bun's built-in test runner. Key test files:
- `packages/core/src/categorize.test.ts`
- `packages/cli/src/prompt.test.ts`
- `packages/store-sqlite/src/index.test.ts`

## CI/CD

- `ci.yml` — tests on push to main and all PRs
- `flaky-check.yml` — scheduled detection (Monday 9am UTC) + manual trigger
- `docs.yml` — deploys docs to GitHub Pages when `packages/docs/**` changes
- `release.yml` — tag-triggered npm publish in dependency order + GitHub Release

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
