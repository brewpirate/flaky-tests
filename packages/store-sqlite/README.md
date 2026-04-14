# @flaky-tests/store-sqlite

Local SQLite store adapter for [flaky-tests](https://github.com/brewpirate/flaky-tests). Uses Bun's built-in SQLite.

## Install

```sh
bun add @flaky-tests/store-sqlite
```

## Usage

```ts
import { SqliteStore } from '@flaky-tests/store-sqlite'

const store = new SqliteStore()
// Tables are created automatically on construction

const patterns = await store.getNewPatterns({ windowDays: 7, threshold: 2 })
await store.close()
```

## Options

| Option | Description | Default |
|---|---|---|
| `dbPath` | Path to the SQLite file | `node_modules/.cache/flaky-tests/failures.db` |

## Requirements

- Bun >= 1.3.0 (uses `bun:sqlite`)

## License

MIT
