# @flaky-tests/store-postgres

PostgreSQL store adapter for [flaky-tests](https://github.com/brewpirate/flaky-tests). Works with any Postgres-compatible database (Neon, AWS RDS, etc.).

## Install

```sh
bun add @flaky-tests/store-postgres
```

## Usage

```ts
import { PostgresStore } from '@flaky-tests/store-postgres'

const store = new PostgresStore({
  connectionString: process.env.DATABASE_URL,
})
await store.migrate() // creates tables and indexes

const patterns = await store.getNewPatterns()
await store.close()
```

## Options

| Option | Description |
|---|---|
| `connectionString` | Full Postgres URL (e.g. `postgres://user:pass@host:5432/db`) |
| `host`, `port`, `database`, `username`, `password` | Individual connection fields (alternative to URL) |
| `ssl` | SSL mode: `true`, `'require'`, `'prefer'`, `'allow'` |
| `tablePrefix` | Table name prefix (default: `flaky_test`) |

## License

MIT
