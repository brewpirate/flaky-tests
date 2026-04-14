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
await store.migrate() // creates tables on first run

const patterns = await store.getNewPatterns()
await store.close()
```

## Options

| Option | Description |
|---|---|
| `url` | Turso database URL (`libsql://...` or `file:///...` for local dev) |
| `authToken` | Turso auth token (not required for local file URLs) |

## License

MIT
