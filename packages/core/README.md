# @flaky-tests/core

Storage-agnostic core types and utilities for [flaky-tests](https://github.com/brewpirate/flaky-tests).

## Install

```sh
bun add @flaky-tests/core
```

## What's included

- **`IStore`** — Interface that all store adapters implement
- **`FlakyPattern`**, **`InsertRunInput`**, **`InsertFailureInput`** — Shared data types
- **`FailureKind`** — Coarse classification: `assertion`, `timeout`, `uncaught`, `unknown`
- **`categorizeError()`** — Classifies an error into a `FailureKind`
- **`validateTablePrefix()`** — SQL identifier validation for store adapters

## Usage

```ts
import type { IStore, FlakyPattern } from '@flaky-tests/core'
import { categorizeError } from '@flaky-tests/core'

const kind = categorizeError(new Error('Timed out')) // 'timeout'
```

## License

MIT
