---
trigger_phrase:
  haiku: "typed error hierarchy boundary"
  opus: "typed apperror hierarchy boundary"
  sonnet: "typed AppError boundary propagation"
---

# Error Handling

## Error Class Hierarchy

All domain errors extend `AppError`. Each subclass carries a machine-readable `readonly code` field for discrimination.

```typescript
// Base class — packages/core/src/errors/index.ts
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) { ... }
}

// Subclasses in errors/index.ts:
InvalidTransitionError  // code: 'INVALID_TRANSITION' — invalid state machine transition
ProviderError           // code: 'PROVIDER_ERROR' — I/O failure from issue provider

// Subclasses in core/context.ts:
ContextOverflowError    // code: 'CONTEXT_OVERFLOW' — SDK context threshold exceeded
RateLimitError          // code: 'RATE_LIMIT' — Claude API rate limit hit
```

## Rule: Throw Typed Errors, Catch at Boundaries

```typescript
// WRONG — generic Error with no code
throw new Error('Issue not found')

// CORRECT — typed error with discriminant
throw new ProviderError('Issue not found', { cause: originalError })
```

Errors propagate up the call stack and are caught at two boundaries:

1. **HTTP error handler** (`packages/server/src/server/middleware/error-handler.ts`) — maps `error.code` to HTTP status
2. **CLI entry point** (`packages/server/src/index.ts`) — logs and exits

## Rule: No Try-Catch in Routes

The global error handler catches everything. Don't wrap individual routes.

**Exception**: SSE streaming and WebSocket handlers may use try-catch for stream lifecycle management (cleanup, connection close).

```typescript
// WRONG — try-catch in route
app.get('/issues/:id', async (context) => {
  try {
    const issue = await issueService.getIssue(context.req.param('id'))
    return context.json(issue)
  } catch (error) {
    return context.json({ error: 'Not found' }, 404)
  }
})

// CORRECT — let the error handler do its job
app.get('/issues/:id', async (context) => {
  const issue = await issueService.getIssue(context.req.param('id'))
  return context.json(issue)
})
```

## Error Code to HTTP Status Mapping

```typescript
const ERROR_CODE_TO_STATUS = {
  INVALID_TRANSITION: 409,  // Conflict
  PROVIDER_ERROR: 502,      // Bad Gateway
  CONTEXT_OVERFLOW: 413,    // Payload Too Large
  RATE_LIMIT: 429,          // Too Many Requests
} as const
```

## Rule: Use `toError()` / `toErrorMessage()` for Unknown Catches

When catching `unknown`, use utilities from `@barf/core/utils/toError`:
- `toError(e)` — coerces to `Error` object (for structured logging)
- `toErrorMessage(e)` — extracts message string (for display/responses)

```typescript
// WRONG
catch (error) {
  logger.error({ err: error }, 'failed')  // error might not be Error
}

// CORRECT
catch (error) {
  logger.error({ err: toError(error) }, 'failed')
}
```

## Rule: No Result/neverthrow

This codebase uses standard `async/await` + `throw`. Functions return `Promise<T>` and throw on failure. Do not introduce Result types, neverthrow, or similar patterns.
