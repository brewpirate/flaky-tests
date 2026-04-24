# @flaky-tests/store-sqlite

Local SQLite store adapter for [flaky-tests](https://github.com/brewpirate/flaky-tests). Uses `@libsql/client` against a local `file:` URL, so the same adapter runs on **both Node and Bun** — SQL is identical to `@flaky-tests/store-turso`; only the URL scheme differs.

## Install

```sh
bun add @flaky-tests/store-sqlite
# or: npm install @flaky-tests/store-sqlite
```

## Usage

```ts
import { SqliteStore } from '@flaky-tests/store-sqlite'

const store = new SqliteStore({ dbPath: '.cache/flaky.db' })
await store.migrate() // idempotent; safe on every startup

const patterns = await store.getNewPatterns({ windowDays: 7, threshold: 2 })
await store.close()
```

## Options

| Option | Description | Default |
|---|---|---|
| `dbPath` | Path to the local SQLite file | `./failures.db` |
| `retry` | Retry policy for transient driver errors (see `RetryOptions` in `@flaky-tests/core`) | — |

## Requirements

- Node >= 20, or Bun >= 1.3.0

## License

MIT
