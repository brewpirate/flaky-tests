# @flaky-tests/cli

CLI for detecting flaky test patterns and generating AI investigation prompts.

## Install

```sh
bun add -g @flaky-tests/cli
```

## Usage

```sh
flaky-tests                           # detect with defaults
flaky-tests --window 14 --threshold 3 # custom detection window
flaky-tests --prompt                  # print AI investigation prompts
flaky-tests --copy                    # copy first prompt to clipboard
flaky-tests --create-issue            # open GitHub issues
flaky-tests --html --out report.html  # generate HTML report
flaky-tests --help                    # show all options
```

## Environment variables

All values flow through `resolveConfig()` in `@flaky-tests/core`.

| Variable | Description | Default |
|---|---|---|
| `FLAKY_TESTS_STORE` | `sqlite`, `turso`, `supabase`, `postgres`, or any type registered via `definePlugin` | `sqlite` |
| `FLAKY_TESTS_STORE_MODULE` | Module specifier to import for `store.type` — overrides the `@flaky-tests/store-<type>` convention. Used for forks or third-party adapters. | — |
| `FLAKY_TESTS_DB` | SQLite DB path override | `node_modules/.cache/flaky-tests/failures.db` |
| `FLAKY_TESTS_CONNECTION_STRING` | DB URL for remote stores (Turso `libsql://`, Postgres `postgres://`, Supabase project URL) | — |
| `FLAKY_TESTS_AUTH_TOKEN` | Auth token for Turso/Supabase | — |
| `FLAKY_TESTS_WINDOW` | Detection window length in days | `7` |
| `FLAKY_TESTS_THRESHOLD` | Min recent failures to flag as flaky | `2` |
| `FLAKY_TESTS_LOG` | Log level: `silent`, `error`, `warn`, `debug` | `warn` |
| `GITHUB_TOKEN` | Required for `--create-issue` | — |
| `GITHUB_REPOSITORY` | `owner/repo` for issue creation (set automatically in GitHub Actions) | — |

## Store dispatch

Stores are resolved through the plugin registry in `@flaky-tests/core`, not a hardcoded switch. On every invocation the CLI:

1. Resolves config from env via `resolveConfig()`.
2. Calls `createStoreFromConfig(config)` which looks up `store-<type>` in `listRegisteredPlugins()` and, if absent, imports `@flaky-tests/store-<type>` (or `FLAKY_TESTS_STORE_MODULE` if set) so the adapter can register itself.
3. Runs `await store.migrate()` — idempotent for all built-in adapters, so running the CLI once against a fresh remote DB sets up the schema with no manual step.
4. Queries `getNewPatterns`, emits output, exits.

## Exit codes

| Code | Meaning |
|---|---|
| `0` | No new flaky patterns detected |
| `1` | New flaky patterns found |
| `2` | Invalid input (bad flags, unresolvable store package) |

## License

MIT
