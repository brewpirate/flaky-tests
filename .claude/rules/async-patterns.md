---
trigger_phrase:
  haiku: "promise worker cancellation patterns"
  opus: "async promise worker safety rules"
  sonnet: "await abort worker subprocess safety"
---

# Async Patterns

## Rule: Always Await Promises

Never fire-and-forget without explicit error handling.

```typescript
// WRONG — errors silently lost
eventBus.publish('issue.transitioned', issue)

// CORRECT — await
await eventBus.publish('issue.transitioned', issue)

// CORRECT — explicit fire-and-forget with error handling
eventBus.publish('issue.transitioned', issue).catch(error => {
  logger.error({ err: error, issueId: issue.id }, 'Failed to publish event')
})
```

## Rule: `Promise.all` for Independent Operations

```typescript
// WRONG — sequential when parallel is possible
const issues = await provider.listIssues()
const config = await loadConfig()
const sessions = await listSessions()

// CORRECT — parallel execution
const [issues, config, sessions] = await Promise.all([
  provider.listIssues(),
  loadConfig(),
  listSessions(),
])
```

## AbortSignal for Cancellation

Workers and long-running operations accept `AbortSignal` for cooperative cancellation:

```typescript
// Pass through deps
const deps: RunLoopDeps = {
  abortSignal: controller.signal,
}

// Check in loops
if (deps.abortSignal?.aborted) {
  logger.info({ issueId }, 'Aborted by user')
  return
}
```

## Worker Protocol

Workers communicate via JSON messages using a discriminated union on the `type` field:

```typescript
// Worker → Main thread message types (see packages/core/src/workers/protocol.ts for full schema)
type WorkerMessage =
  | { type: 'log'; data: string }
  | { type: 'progress'; tokens: number; contextPct: number }
  | { type: 'state-change'; issueId: string; newState: IssueState }
  | { type: 'complete'; result: 'ok' | 'stuck' | 'split' | 'overflow' }
  | { type: 'error'; message: string }
  | { type: 'stats-written'; issueId: string }
  | { type: 'running'; issueId: string }
  | { type: 'issue-start'; issueId: string; phase: string }
  | { type: 'issue-end'; issueId: string; phase: string }
```

Workers send messages via `self.postMessage(message)` when in worker context.

## Worker Pool Rules

- **Lazy creation**: workers are spawned on demand, not pre-allocated
- **Issue dedup**: pool rejects duplicate workers for the same issue
- **Graceful shutdown**: `pool.shutdown()` terminates all workers
- **Kill by issue**: `pool.kill(issueId)` stops a specific worker

## Context Monitoring

The SDK stream consumer tracks input tokens via async iterator. Throws `ContextOverflowError` when the threshold is exceeded (caught and converted to `'overflow'` outcome).

## Stream Logging

When `DISABLE_LOG_STREAM` is not set, raw JSONL is appended per-session to `.barf/streams/{sessionId}.jsonl`. Used for debugging Claude output.

## Subprocess Safety

**Always** use `execFileNoThrow()` from `@barf/core/utils/execFileNoThrow` for async subprocesses. It uses `Bun.spawn` with array arguments, preventing shell injection.

```typescript
// WRONG — shell injection risk
import { exec } from 'child_process'
exec(`git log --oneline ${userInput}`)

// CORRECT — array args via execFileNoThrow
import { execFileNoThrow } from '@barf/core/utils/execFileNoThrow'
const result = await execFileNoThrow('git', ['log', '--oneline', userInput])
```

**Exception**: `execFileSync` from `node:child_process` with array args is acceptable for startup-only checks (e.g., `execFileSync('which', ['claude'])`). Never use it at runtime or with user-provided input.
