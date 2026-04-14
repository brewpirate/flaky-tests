# Releasing Packages

This project uses [changesets](https://github.com/changesets/changesets) for independent package versioning and publishing. Packages are published to both **npm** and **JSR**.

## How it works

1. You make changes and add a **changeset** describing what changed
2. On push to `main`, the release workflow opens a **"Version Packages" PR** with bumped versions and updated CHANGELOGs
3. When that PR is merged, the workflow **publishes only the changed packages** to npm and JSR

## Adding a changeset

After making changes, run:

```sh
bunx changeset
```

You'll be prompted to:
- Select which packages were affected
- Choose a bump type (`patch`, `minor`, or `major`)
- Write a summary of the change

This creates a markdown file in `.changeset/`. Commit it with your changes.

### Example

```sh
$ bunx changeset
# Select: @flaky-tests/core
# Bump: patch
# Summary: fix stripTimestampPrefix for Postgres timestamptz format

$ git add .changeset/
$ git commit -m "fix: timestamp prefix stripping for Postgres"
```

### When to use each bump type

| Type | When |
|---|---|
| `patch` | Bug fixes, internal changes, dependency updates |
| `minor` | New features, new exports, new optional parameters |
| `major` | Breaking changes to public API, removed exports, changed behavior |

## Publishing flow

### Automatic (CI)

On every push to `main`, the GitHub Action (`release.yml`) runs:

1. If there are unreleased changesets → opens/updates a **"Version Packages" PR**
   - Bumps `version` in affected `package.json` files
   - Generates/updates `CHANGELOG.md` per package
   - Removes consumed changeset files
2. If that PR is merged (no pending changesets) → **publishes** to npm and JSR

### Manual (local)

If you need to publish manually:

```sh
# 1. Consume changesets and bump versions
bun run version-packages

# 2. Build and publish
bun run release
```

Requires `NPM_TOKEN` in your environment and `bunx npm login` for npm auth.

## Publishing a single package

Just create a changeset that only selects one package. When the Version Packages PR is merged, only that package (and its dependents if configured) will be published.

```sh
$ bunx changeset
# Select: @flaky-tests/store-postgres (only)
# Bump: patch
# Summary: add missing index on failed_at column
```

## Dependency cascading

Configured via `updateInternalDependencies: "patch"` in `.changeset/config.json`:

- If `@flaky-tests/core` gets a patch bump, all packages that depend on it (`store-*`, `plugin-*`, `cli`) automatically get their `@flaky-tests/core` dependency range updated
- Dependents are **not** re-published unless they also have their own changeset

## Package publish order

The publish command handles dependency ordering automatically:

1. `@flaky-tests/core` (no deps)
2. `@flaky-tests/store-sqlite` (depends on core)
3. `@flaky-tests/store-turso`, `store-supabase`, `store-postgres` (depend on core)
4. `@flaky-tests/plugin-bun` (depends on core + store-sqlite)
5. `@flaky-tests/plugin-vitest` (depends on core)
6. `@flaky-tests/cli` (depends on core + store-sqlite + optional stores)

## Secrets required

| Secret | Where | Purpose |
|---|---|---|
| `NPM_TOKEN` | GitHub repo settings | npm publish authentication |
| `GITHUB_TOKEN` | Automatic | Creating version PRs and releases |

## First-time setup

1. Create an npm account and org scope: `npm login && npm org create flaky-tests`
2. Generate an npm automation token: npm.js → Access Tokens → Generate New Token (Granular, publish)
3. Add `NPM_TOKEN` to GitHub repo → Settings → Secrets → Actions
4. Register `@flaky-tests` scope on JSR: https://jsr.io/new
