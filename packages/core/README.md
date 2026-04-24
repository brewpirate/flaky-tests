# @flaky-tests/core

Storage-agnostic core for [flaky-tests](https://github.com/brewpirate/flaky-tests): shared types, the `IStore` contract, the unified config resolver, and the plugin registry that makes every store adapter swappable.

## Install

```sh
bun add @flaky-tests/core
```

## What's included

### Types and shared utilities

- **`IStore`** — Interface every store adapter implements (`migrate`, `insertRun`, `updateRun`, `insertFailure`, `insertFailures`, `getNewPatterns`, `getRecentRuns`, `listFailures`, `close`).
- **`FlakyPattern`**, **`InsertRunInput`**, **`InsertFailureInput`** — Data types exchanged with stores.
- **`FailureKind`** — Coarse classification: `assertion`, `timeout`, `uncaught`, `unknown`.
- **`categorizeError(error)`** — Classifies an unknown into a `FailureKind`.
- **`extractMessage(error)`**, **`extractStack(error)`** — Safe unwrappers for unknown errors.
- **`validateTablePrefix(prefix)`** — SQL identifier guard used by every store that supports a `tablePrefix`.
- **`ValidationError`**, **`StoreError`**, **`ConfigError`**, **`MissingStorePackageError`** — Typed errors with uniform shape.

### Config

- **`resolveConfig()`** — Single source of truth for every `process.env` value the app reads. Overloaded: no args → reads `process.env` (memoized); pass a `NodeJS.ProcessEnv` to parse custom env; pass a `Config` to install a pre-built one (useful in tests).
- **`Config`** — Typed result of `resolveConfig()`. The `store` field is a discriminated union over `type: 'sqlite' | 'turso' | 'supabase' | 'postgres'`; every variant accepts an optional `module` override for pointing the dispatcher at a fork or alternate package path.
- **`getTestCredentials()`** — Dedicated reader for integration-test env (`INTEGRATION`, `*_TEST_URL`, `*_TEST_KEY`) so test files never touch `process.env` directly.

### Plugin registry

The plugin registry is how stores and runners get discovered at runtime. It is the one piece of the architecture that lets a new store adapter be added without modifying core, the CLI, or any plugin.

```ts
import type { Config, IStore } from '@flaky-tests/core'
import {
  definePlugin,
  listRegisteredPlugins,
  createStoreFromConfig,
} from '@flaky-tests/core'

// Author of a store adapter: register a descriptor at module import time.
export const myStorePlugin = definePlugin({
  name: 'store-mything',
  create(config: Config): IStore {
    return new MyStore(/* unpack config */)
  },
})

// Host (CLI / preload): dispatch through the registry — no hardcoded switch.
const store = await createStoreFromConfig(resolveConfig())
```

#### `createStoreFromConfig(config, importer)` resolution order

1. **Already registered?** Look up `store-<type>` in `listRegisteredPlugins()`. If the module was imported elsewhere, the descriptor is there.
2. **Candidate imports.** Call the supplied `importer(spec)` for each of, in order:
   1. `config.store.module` — explicit override (also settable via `FLAKY_TESTS_STORE_MODULE`).
   2. `@flaky-tests/store-<type>` — convention for first-party adapters.
   After each successful import, re-check the registry.
3. **Fail loudly.** Throw `MissingStorePackageError` with an actionable `bun add` hint.

#### Why `importer` is an injected parameter

`await import(spec)` resolves relative to the **calling module's** filesystem location. If core did the `import()` itself, Node would walk up from `packages/core/…` — missing store packages linked into a consumer's own `node_modules` (workspace symlinks don't hoist the way published-package installs do).

The consumer (CLI / plugin-bun / your own preload) passes a closure that captures its own module context:

```ts
await createStoreFromConfig(config, (spec) => import(spec))
```

The closure's `import(spec)` resolves from the consumer's location, where optional store deps actually live. This is the standard ecosystem pattern (Jest transformers, webpack loaders, Vite plugins all take a resolve callback for the same reason).

A default `(spec) => import(spec)` is provided so tests and fully-bundled builds still work without ceremony, but real hosts should always pass their own.

This registry-first dispatch is why every store package is an `optionalDependencies` entry on the CLI and plugin-bun — users install only the backend they actually use.

## Usage

```ts
import {
  type IStore,
  type FlakyPattern,
  resolveConfig,
  createStoreFromConfig,
  categorizeError,
} from '@flaky-tests/core'

const config = resolveConfig()
const store = await createStoreFromConfig(config, (spec) => import(spec))
await store.migrate()
const patterns = await store.getNewPatterns()
await store.close()

const kind = categorizeError(new Error('Timed out')) // 'timeout'
```

## Test helpers

`@flaky-tests/core/test-helpers` exports:

- **`runContractTests(label, makeStore)`** — 15-scenario shared suite every store invokes so `IStore` semantics stay locked in.
- **`daysAgo`**, **`makeRun`**, **`makeFailure`** — Fixture builders.

Import only from adapter test files:

```ts
import { runContractTests } from '@flaky-tests/core/test-helpers'
runContractTests('mything', () => new MyStore({ /* test config */ }))
```

## License

MIT
