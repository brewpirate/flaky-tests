---
trigger_phrase:
  haiku: "monorepo alias barrel import rules"
  opus: "monorepo path alias import rules"
  sonnet: "barf monorepo import alias rules"
---

# Imports and Modules

## Path Aliases

All imports use the `@barf/<package>/*` path alias, which maps to `packages/<package>/src/*`:

```typescript
// Within packages/core/ — use @barf/core/*
import { createLogger } from '@barf/core/utils/logger'
import type { Config } from '@barf/core/types'

// Within packages/server/ — use @barf/server/*
import { IssueService } from '@barf/server/server/services/issue-service'

// Cross-package — same pattern
import type { IssueProvider } from '@barf/core/core/issue/base'
import { triageIssue } from '@barf/core/core/triage'
```

Test imports:

```typescript
import { makeIssue, makeProvider } from '@tests/fixtures/provider'
```

## Rule: No Relative Imports (Cross-Module)

```typescript
// WRONG — crossing module boundaries
import { parseIssue } from '../../../core/issue'
import { logger } from '../../utils/logger'

// CORRECT
import { parseIssue } from '@barf/core/core/issue'
import { logger } from '@barf/core/utils/logger'
```

**Within the same module**: use `./sibling` relative imports (e.g., `batch/audit-gate.ts` importing `./session-index`).

**Exception**: `../dist/` relative imports for Bun `with { type: 'text' }` asset embeds in `static.ts`.

## Barrel Files

Each module's `index.ts` re-exports its public API:

```typescript
// packages/core/src/core/batch/index.ts
export { runLoop } from './loop'
export type { RunLoopDeps } from './loop'
export { shouldContinue } from './helpers'
```

Consumers import from the barrel, not internal files:

```typescript
// CORRECT
import { runLoop, RunLoopDeps } from '@barf/core/core/batch'

// WRONG — reaching into internal file
import { runLoop } from '@barf/core/core/batch/loop'
```

## Import Organization

Group imports in this order, separated by blank lines:

1. External dependencies (`zod`, `hono`, `@anthropic-ai/claude-agent-sdk`)
2. Cross-package imports (`@barf/core/...`)
3. Intra-package imports (`@barf/<package>/...`)
4. Type-only imports (`import type { ... }`) — inline `type` qualifiers in value imports (`import { type Foo, bar }`) are also acceptable

## `mock.module()` Path Matching

**Critical rule** (cross-ref with `testing.md`): `mock.module()` paths must match the exact string used in production imports. In the monorepo, production code uses `@barf/core/...`, so mocks must too:

```typescript
// CORRECT
mock.module('@barf/core/utils/logger', () => ({ ... }))

// WRONG — different alias, mock silently does nothing
mock.module('@/utils/logger', () => ({ ... }))
```
