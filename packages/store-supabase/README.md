# @flaky-tests/store-supabase

[Supabase](https://supabase.com) store adapter for [flaky-tests](https://github.com/brewpirate/flaky-tests).

## Install

```sh
bun add @flaky-tests/store-supabase
```

## Setup

Tables must be created manually via the Supabase Dashboard SQL editor. See the [store setup guide](https://brewpirate.github.io/flaky-tests/stores/supabase/) for the required schema.

## Usage

```ts
import { SupabaseStore } from '@flaky-tests/store-supabase'

const store = new SupabaseStore({
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_KEY,
})
await store.migrate() // validates tables exist

const patterns = await store.getNewPatterns()
await store.close()
```

## Options

| Option | Description |
|---|---|
| `url` | Supabase project URL |
| `key` | Supabase anon or service role key |
| `tablePrefix` | Table name prefix (default: `flaky_test`) |

## License

MIT
