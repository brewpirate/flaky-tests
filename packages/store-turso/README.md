# @flaky-tests/store-turso

[Turso](https://turso.tech) (remote SQLite) store adapter for [flaky-tests](https://github.com/brewpirate/flaky-tests).

## Install

```sh
bun add @flaky-tests/store-turso
```

## Usage

```ts
import { TursoStore } from '@flaky-tests/store-turso'

const store = new TursoStore({
  url: process.env.TURSO_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
})
await store.migrate() // creates tables on first run (idempotent)

const patterns = await store.getNewPatterns()
await store.close()
```

## Schema migration

The `flaky-tests` CLI calls `migrate()` automatically before every query,
so running `bunx flaky-tests` once against a fresh Turso database creates
the `runs` and `failures` tables. If you embed `TursoStore` directly (e.g.
from the Bun/Vitest plugin), call `await store.migrate()` once at setup
time — the method is idempotent (`CREATE TABLE IF NOT EXISTS`).

## Options

| Option | Description |
|---|---|
| `url` | Turso database URL (`libsql://...` or `file:///...` for local dev) |
| `authToken` | Turso auth token (not required for local file URLs) |

## License

MIT
