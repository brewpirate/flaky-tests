# @flaky-tests/store-supabase

[Supabase](https://supabase.com) store adapter for [flaky-tests](https://github.com/brewpirate/flaky-tests).

## Install

```sh
bun add @flaky-tests/store-supabase
```

## Setup

Supabase's JS client can't run DDL, so tables **must be created manually**
via the Supabase Dashboard SQL editor. See the [store setup guide](https://brewpirate.github.io/flaky-tests/stores/supabase/)
for the required schema. The `flaky-tests` CLI calls `migrate()` on every
invocation, which for Supabase just *verifies* the tables exist — if they
don't, you'll get a clean error pointing at this page.

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
