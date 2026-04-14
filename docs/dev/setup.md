# Development Setup

## Prerequisites

- [Bun](https://bun.sh) v1.3.0+

## Getting started

```sh
git clone https://github.com/brewpirate/flaky-tests.git
cd flaky-tests
bun install
```

## Scripts

| Command | Description |
|---|---|
| `bun test` | Run all tests |
| `bun run build` | Build all packages to `dist/` |
| `bun run check` | Lint and format check (Biome) |
| `bun run check:fix` | Auto-fix lint and format issues |
| `bunx changeset` | Create a changeset for your changes |

## Running tests

```sh
bun test
```

Tests are colocated with source files (`*.test.ts` next to `*.ts`).

## Using locally in another project

Link the packages you need from the monorepo:

```sh
# In the flaky-tests repo
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

Linked packages resolve to your local source — edits are reflected immediately with no rebuild.

To unlink:

```sh
bun unlink @flaky-tests/plugin-bun
```

## Project structure

```
packages/
  cli/            # Pattern detection CLI
  core/           # Shared types and IStore interface
  plugin-bun/     # Bun test preload
  plugin-vitest/  # Vitest reporter
  store-sqlite/   # Local SQLite store
  store-turso/    # Turso (remote SQLite) store
  store-supabase/ # Supabase store
  store-postgres/ # PostgreSQL / Neon store
  docs/           # Documentation site (Astro + Starlight)
```

## Build architecture

Each package uses conditional exports:
- **Bun** resolves directly to TypeScript source (`./src/index.ts`) — zero build overhead
- **Node/other** resolves to compiled JavaScript (`./dist/index.js`)

Build with `bun run build` to generate `dist/` output. Dependencies are externalized (not bundled).
