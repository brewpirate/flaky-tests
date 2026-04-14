# @flaky-tests/plugin-bun

Bun test preload plugin for [flaky-tests](https://github.com/brewpirate/flaky-tests). Captures every test failure to your store automatically.

## Install

```sh
bun add -D @flaky-tests/plugin-bun
```

## Setup

Add the preload to your `bunfig.toml`:

```toml
[test]
preload = ["@flaky-tests/plugin-bun/preload"]
```

Then run tests as usual:

```sh
bun test
```

Failures are captured automatically to a local SQLite database. No code changes needed.

## Exports

| Export | Description |
|---|---|
| `@flaky-tests/plugin-bun` | Core plugin utilities |
| `@flaky-tests/plugin-bun/preload` | Preload entry point (use in bunfig.toml) |
| `@flaky-tests/plugin-bun/run-tracked` | Tracked test runner with run reconciliation |

## Requirements

- Bun >= 1.3.0

## License

MIT
