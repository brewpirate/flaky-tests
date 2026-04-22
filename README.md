<p align="center">
  <img src="mrflaky.png" alt="Mr. Flaky" width="120">
</p>

# flaky-tests

> Zero-friction flaky test detection for Bun and Vitest.

[![GitHub Marketplace](https://img.shields.io/badge/GitHub%20Marketplace-flaky--tests-blue?logo=github)](https://github.com/marketplace/actions/flaky-tests)
[![npm](https://img.shields.io/npm/v/@flaky-tests/cli)](https://www.npmjs.com/package/@flaky-tests/cli)

**flaky-tests** hooks into your test runner, records every failure to a database, and detects when tests have *newly* started failing intermittently — then generates an AI investigation prompt and opens a GitHub issue automatically.

## How it works

1. **Capture** — A Bun preload or Vitest reporter writes every failure to your store (SQLite, Turso, Supabase, or Postgres)
2. **Detect** — The CLI compares failure counts across two equal time windows. Tests with failures in the current window but zero in the prior are flagged
3. **Investigate** — A structured prompt is generated for Claude, Cursor, or Copilot
4. **Notify** — A GitHub issue is opened with the prompt embedded

## Features

- **Zero-config capture** — single preload line for Bun, single reporter entry for Vitest
- **Pluggable stores** — SQLite, Turso, Supabase, Postgres; swap with an env var
- **Project isolation** — shared stores partition runs by `project` so multiple repos can share one database
- **Versioned schema migrations** — SQLite and Turso stores ship a numbered migration runner; `auto-migrate` runs before queries so upgrades need no manual step
- **Resilient remote writes** — network-backed stores (Turso, Supabase, Postgres) retry with exponential backoff on transient failures
- **In-flight write drain** — the Bun preload flushes pending failure writes before the process exits, so CI runs don't lose the last few failures
- **AbortSignal on reads** — all `getNewPatterns` / read paths accept an `AbortSignal` for bounded CLI runs
- **Typed error surface** — every adapter wraps driver errors as `StoreError` with a stable code, so callers can branch on failure kind without sniffing driver internals
- **AI-ready prompts + GitHub issues** — structured investigation prompts, duplicate-detection when opening issues, and an HTML report

<p align="center">
  <img src="docs/flaky-report-preview.png" alt="HTML report preview — severity-ranked pattern cards with kind breakdown, hot files, and recent runs" width="820">
</p>

## Quick start

```sh
bun add -D @flaky-tests/plugin-bun
```

```toml
# bunfig.toml
[test]
preload = ["@flaky-tests/plugin-bun/preload"]
```

```sh
bun test   # failures are captured automatically
bunx @flaky-tests/cli --prompt
```

→ [Full documentation](https://brewpirate.github.io/flaky-tests)

---

## Pluggable store architecture

`flaky-tests` ships four store adapters out of the box (sqlite, turso,
supabase, postgres), but the plugin and CLI never hardcode which one you
use. The dispatcher in `@flaky-tests/core` looks up a plugin **registry**
at runtime:

```
FLAKY_TESTS_STORE=turso → createStoreFromConfig(config)
                         └─ listRegisteredPlugins()
                            └─ find { name: 'store-turso' }
                               └─ fallback: import('@flaky-tests/store-turso')
                                  └─ descriptor.create(config)
```

Each store package calls `definePlugin({ name: 'store-<type>', create })`
at its own import time. The dispatcher only cares about the registry —
**there is no hardcoded list of adapter names in core, cli, or
plugin-bun**. Adding a new backend means shipping a new package; nothing
in this repo needs to change.

See the [custom stores guide](https://brewpirate.github.io/flaky-tests/guides/custom-stores/)
for authoring a third-party adapter.

---

## GitHub Action

Runs `flaky-tests check` in CI and opens issues when new patterns are detected.

### Usage

```yaml
- uses: brewpirate/flaky-tests@v1
  with:
    store: turso
    connection-string: ${{ secrets.TURSO_URL }}
    auth-token: ${{ secrets.TURSO_AUTH_TOKEN }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    create-issues: 'true'
```

### Inputs

| Input | Description | Default |
|---|---|---|
| `store` | Store backend: `turso`, `supabase`, `postgres` | — |
| `connection-string` | Database URL | — |
| `auth-token` | Auth token (Turso / Supabase) | — |
| `github-token` | Token to open issues | `${{ github.token }}` |
| `window-days` | Detection window length in days | `7` |
| `threshold` | Min failures to flag as flaky | `2` |
| `create-issues` | Open GitHub issues for new patterns | `true` |

### Scheduled detection workflow

```yaml
# .github/workflows/flaky-check.yml
name: Flaky test detection
on:
  schedule:
    - cron: '0 9 * * 1'   # Monday 9am UTC
  workflow_dispatch:

jobs:
  detect:
    runs-on: ubuntu-latest
    permissions:
      issues: write
    steps:
      - uses: brewpirate/flaky-tests@v1
        with:
          store: turso
          connection-string: ${{ secrets.TURSO_URL }}
          auth-token: ${{ secrets.TURSO_AUTH_TOKEN }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### CI with capture on every run

```yaml
# .github/workflows/ci.yml
- run: bun test
  env:
    FLAKY_TESTS_STORE: turso
    FLAKY_TESTS_CONNECTION_STRING: ${{ secrets.TURSO_URL }}
    FLAKY_TESTS_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}

- if: github.ref == 'refs/heads/main'
  uses: brewpirate/flaky-tests@v1
  with:
    store: turso
    connection-string: ${{ secrets.TURSO_URL }}
    auth-token: ${{ secrets.TURSO_AUTH_TOKEN }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
```

---

## Development

### Prerequisites

- [Bun](https://bun.sh) v1.3+

### Setup

```sh
git clone https://github.com/brewpirate/flaky-tests.git
cd flaky-tests
bun install
```

### Scripts

| Script | Description |
|--------|-------------|
| `bun test` | Run unit tests |
| `bun run test:integration` | Run integration tests (requires databases) |
| `bun run test:all` | Run all tests (unit + integration) |
| `bun run test:cli` | Run the CLI against local SQLite DB |
| `bun run report` | Generate HTML report |
| `bun run lint` | Lint with Biome |
| `bun run check` | Lint + format check (Biome) |
| `bun run typecheck` | Run `tsc --noEmit` across every package |
| `bun run build` | Build all packages |

### Testing

Unit tests run on every `bun test` — no external services needed.

Integration tests cover the remote stores (Turso, Supabase, Postgres) and are **skipped by default**. To run them:

```sh
# Turso — uses in-memory, no external service needed
INTEGRATION=1 bun test packages/store-turso

# Postgres — needs a running instance
docker run -d --name ft-pg -e POSTGRES_PASSWORD=test -p 5432:5432 postgres:16
INTEGRATION=1 POSTGRES_TEST_URL=postgres://postgres:test@localhost:5432/postgres bun test packages/store-postgres

# Supabase — needs a project with tables created (see test file for schema)
INTEGRATION=1 SUPABASE_TEST_URL=https://your-project.supabase.co SUPABASE_TEST_KEY=your-key bun test packages/store-supabase
```

Integration tests also run in CI on push to main via `.github/workflows/integration.yml`.

### Using packages locally (before publishing)

Link the packages you need from the monorepo:

```sh
cd packages/plugin-bun && bun link
cd ../core && bun link
cd ../store-sqlite && bun link
```

Then in your project:

```sh
bun link @flaky-tests/plugin-bun
bun link @flaky-tests/core
bun link @flaky-tests/store-sqlite
```

Edits in the monorepo are reflected immediately. Unlink with `bun unlink @flaky-tests/plugin-bun`.

See also the [dev docs](docs/dev/) for more contributor guides.

---

## Packages

| Package | Description |
|---|---|
| [`@flaky-tests/plugin-bun`](packages/plugin-bun) | Bun test preload |
| [`@flaky-tests/plugin-vitest`](packages/plugin-vitest) | Vitest reporter |
| [`@flaky-tests/cli`](packages/cli) | Pattern detection CLI |
| [`@flaky-tests/core`](packages/core) | Shared types and `IStore` interface |
| [`@flaky-tests/store-sqlite`](packages/store-sqlite) | Local SQLite |
| [`@flaky-tests/store-turso`](packages/store-turso) | Turso (remote SQLite) |
| [`@flaky-tests/store-supabase`](packages/store-supabase) | Supabase |
| [`@flaky-tests/store-postgres`](packages/store-postgres) | PostgreSQL / Neon |

## Store comparison

| Store | Shared across machines | Cost | Setup |
|---|---|---|---|
| SQLite | No (local only) | Free | Zero config |
| Turso | Yes | Free tier (500 DBs) | `turso db create` |
| Supabase | Yes | Free tier | Dashboard |
| Postgres | Yes | Varies | Connection string |

## License

MIT
