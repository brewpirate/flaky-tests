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

| Variable | Description | Default |
|---|---|---|
| `FLAKY_TESTS_STORE` | `sqlite`, `turso`, `supabase`, `postgres` | `sqlite` |
| `FLAKY_TESTS_DB` | SQLite DB path override | `node_modules/.cache/flaky-tests/failures.db` |
| `FLAKY_TESTS_CONNECTION_STRING` | DB URL for remote stores | — |
| `FLAKY_TESTS_AUTH_TOKEN` | Auth token for Turso/Supabase | — |
| `GITHUB_TOKEN` | Required for `--create-issue` | — |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | No new flaky patterns detected |
| `1` | New flaky patterns found |
| `2` | Invalid input (bad flags) |

## License

MIT
