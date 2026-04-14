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
    TURSO_URL: ${{ secrets.TURSO_URL }}
    TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}

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

See the [dev docs](docs/dev/) for contributor guides:

- [Setup and local development](docs/dev/setup.md)
- [Package guide and gotchas](docs/dev/packages.md)
- [Creating a release](docs/dev/releasing.md)

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
