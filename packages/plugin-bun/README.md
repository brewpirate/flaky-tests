# @flaky-tests/plugin-bun

Bun test preload for [flaky-tests](https://github.com/brewpirate/flaky-tests). Captures every test failure to your store automatically.

## Install

```sh
bun add -D @flaky-tests/plugin-bun
```

You also need **exactly one** store adapter. They're all listed as `optionalDependencies` on this package so nothing is pulled in by default — pick the one you need:

```sh
bun add -D @flaky-tests/store-sqlite   # default, local file
# or
bun add -D @flaky-tests/store-turso
bun add -D @flaky-tests/store-postgres
bun add -D @flaky-tests/store-supabase
```

## Setup

```toml
# bunfig.toml
[test]
preload = ["@flaky-tests/plugin-bun/preload"]
```

```sh
bun test
```

## Store routing

The preload is **not** hardcoded to any particular adapter. At load time it calls `resolveConfig()` from `@flaky-tests/core`, then dispatches through the plugin registry:

- `FLAKY_TESTS_STORE=sqlite` (default) → `@flaky-tests/store-sqlite`
- `FLAKY_TESTS_STORE=turso` + `FLAKY_TESTS_CONNECTION_STRING=libsql://…` + `FLAKY_TESTS_AUTH_TOKEN=…` → `@flaky-tests/store-turso`
- `FLAKY_TESTS_STORE=postgres` + `FLAKY_TESTS_CONNECTION_STRING=postgres://…` → `@flaky-tests/store-postgres`
- `FLAKY_TESTS_STORE=supabase` + `FLAKY_TESTS_CONNECTION_STRING=https://…supabase.co` + `FLAKY_TESTS_AUTH_TOKEN=…` → `@flaky-tests/store-supabase`

If the configured adapter's package isn't installed, the preload throws `MissingStorePackageError` with an actionable `bun add …` hint. It never silently falls back to SQLite — silent data loss on remote stores is worse than a loud failure.

Set `FLAKY_TESTS_DISABLE=1` to turn the preload into a no-op.

## Third-party stores

If you want to use a store adapter that isn't in the `@flaky-tests/*` namespace, author your own preload file:

```ts
// my-preload.ts
import '@acme/my-store' // registers `definePlugin({ name: 'store-acme', ... })`
import {
  createStoreFromConfig,
  resolveConfig,
} from '@flaky-tests/core'
import { createPreload } from '@flaky-tests/plugin-bun'

const config = resolveConfig()
if (!config.plugin.disabled) {
  const store = await createStoreFromConfig(config)
  createPreload(store)
}
```

```toml
# bunfig.toml
[test]
preload = ["./my-preload.ts"]
```

See the [custom stores guide](https://brewpirate.github.io/flaky-tests/guides/custom-stores/) for a full walkthrough.

## Exports

| Export | Description |
|---|---|
| `@flaky-tests/plugin-bun` | `createPreload(store)` — the wiring helper you call from a custom preload |
| `@flaky-tests/plugin-bun/preload` | Ready-made store-agnostic preload entry (use in `bunfig.toml`) |
| `@flaky-tests/plugin-bun/run-tracked` | Tracked test runner with run-status reconciliation (SQLite-only) |

## Requirements

- Bun >= 1.3.0

## License

MIT
