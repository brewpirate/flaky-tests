# @flaky-tests/plugin-vitest

Vitest reporter plugin for [flaky-tests](https://github.com/brewpirate/flaky-tests). Captures every test failure to your store automatically.

## Install

```sh
bun add -D @flaky-tests/plugin-vitest
```

## Setup

Add the reporter to your Vitest config:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: ['default', '@flaky-tests/plugin-vitest'],
  },
})
```

Then run tests as usual:

```sh
vitest
```

## Environment variables

Configure the store via environment variables:

| Variable | Description | Default |
|---|---|---|
| `FLAKY_TESTS_STORE` | `sqlite`, `turso`, `supabase`, `postgres` | `sqlite` |
| `FLAKY_TESTS_CONNECTION_STRING` | DB URL for remote stores | — |
| `FLAKY_TESTS_AUTH_TOKEN` | Auth token for Turso/Supabase | — |

## Requirements

- Vitest >= 1.0.0

## License

MIT
