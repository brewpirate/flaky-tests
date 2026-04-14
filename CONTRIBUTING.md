# Contributing to flaky-tests

Thanks for your interest in contributing! This guide covers everything you need to get started.

## Getting started

```sh
git clone https://github.com/brewpirate/flaky-tests.git
cd flaky-tests
bun install
bun test    # 89+ tests should pass
bun run build  # builds all packages to dist/
```

See [docs/dev/setup.md](docs/dev/setup.md) for detailed setup instructions.

## Making changes

1. Create a branch: `git checkout -b my-change`
2. Make your changes
3. Run checks: `bun run check && bun test`
4. Add a changeset: `bunx changeset` (see [docs/dev/releasing.md](docs/dev/releasing.md))
5. Commit and open a PR

## Project structure

```
packages/
  core/           # Shared types and IStore interface
  cli/            # Pattern detection CLI
  plugin-bun/     # Bun test preload
  plugin-vitest/  # Vitest reporter
  store-sqlite/   # Local SQLite store
  store-turso/    # Turso (remote SQLite) store
  store-supabase/ # Supabase store
  store-postgres/ # PostgreSQL store
  docs/           # Documentation site (Astro + Starlight)
```

## Code style

- **Linting/formatting**: Biome (`bun run check:fix` to auto-fix)
- **TypeScript**: Strict mode, no `any`, explicit return types on exports
- **Naming**: No abbreviations, kebab-case files, camelCase functions
- **Options objects**: Functions with 3+ parameters use a single options object
- **Tests**: Colocated with source (`*.test.ts` next to `*.ts`)

See `.claude/rules/` for the full style guide.

## Adding a new store adapter

1. Create `packages/store-yourdb/`
2. Implement the `IStore` interface from `@flaky-tests/core`
3. Include a `migrate()` method that creates tables idempotently
4. Add `tablePrefix` support with `validateTablePrefix()` from core
5. Add tests, README, `package.json`, `jsr.json`, `tsconfig.build.json`
6. Add the package to the publish steps in `.github/workflows/release.yml`

## Adding a new test runner plugin

1. Create `packages/plugin-yourrunner/`
2. Hook into the runner's lifecycle to capture failures
3. Use `captureGitInfo()` pattern from `plugin-bun/src/git.ts`
4. Write failures to the store via `IStore.insertFailure()`

## Reporting bugs

Open an issue at [github.com/brewpirate/flaky-tests/issues](https://github.com/brewpirate/flaky-tests/issues) with:
- What you expected vs. what happened
- Steps to reproduce
- Store backend and Bun/Node version

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
