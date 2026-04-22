# @flaky-tests/plugin-vitest

Vitest reporter for [flaky-tests](https://github.com/brewpirate/flaky-tests). Captures every test failure to your store automatically.

## Install

```sh
bun add -D @flaky-tests/plugin-vitest
```

Plus one store adapter (each lives in its own package so you only install what you use):

```sh
bun add -D @flaky-tests/store-sqlite   # or -turso / -postgres / -supabase
```

## Setup

The reporter's constructor takes an `IStore`, so you resolve the store once and hand it to the reporter. The easiest path is to let `@flaky-tests/core` dispatch for you:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'
import {
  createStoreFromConfig,
  resolveConfig,
} from '@flaky-tests/core'
import { FlakyTestsReporter } from '@flaky-tests/plugin-vitest'

const store = await createStoreFromConfig(
  resolveConfig(),
  (spec) => import(spec),
)

export default defineConfig({
  test: {
    reporters: ['default', new FlakyTestsReporter(store)],
  },
})
```

Config flows through env vars — see the [env reference](https://brewpirate.github.io/flaky-tests/reference/env-vars/) for the full list. Typical remote-store setup:

```sh
FLAKY_TESTS_STORE=turso \
FLAKY_TESTS_CONNECTION_STRING=libsql://… \
FLAKY_TESTS_AUTH_TOKEN=… \
vitest
```

## Store dispatch

`createStoreFromConfig` goes through the plugin registry in `@flaky-tests/core` — **no hardcoded adapter list**. If the package for the configured `FLAKY_TESTS_STORE` isn't installed, the call throws `MissingStorePackageError` with an actionable `bun add …` hint. Third-party adapters are first-class; see the [custom stores guide](https://brewpirate.github.io/flaky-tests/guides/custom-stores/).

## Manual wiring

If you prefer to construct the store yourself (e.g. to avoid a top-level `await` in your Vitest config):

```ts
import { SqliteStore } from '@flaky-tests/store-sqlite'
import { FlakyTestsReporter } from '@flaky-tests/plugin-vitest'

const store = new SqliteStore({ dbPath: '.cache/flaky.db' })

export default defineConfig({
  test: {
    reporters: ['default', new FlakyTestsReporter(store)],
  },
})
```

## Requirements

- Vitest >= 1.0.0

## License

MIT
