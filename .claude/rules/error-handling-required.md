---
slug: error-handling-required
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - resilience
  - error-handling
  - reliability
manifest:
  install_path: .claude/rules/error-handling-required.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  No empty catches, no swallowed errors, every async path handles rejection
=======
  Empty catches and unhandled rejections let failures propagate silently, corrupting state or producing confusing downstream errors hours later. Every error path must log, throw, or return a typed failure so problems are caught where they originate, not where they explode.
trigger_phrase:
  haiku: "error handling required no empty catch"
  opus: "error handling required no swallowed errors"
  sonnet: "error handling required no empty catches"
>>>>>>> Stashed changes
---

# Error Handling Required

## What to flag
- Empty `catch` blocks or catch blocks containing only a comment like `// ignore`
- `async` functions without a `.catch()` or `try/catch` wrapping the async operation
- Promise chains (`.then().then()`) with no terminal `.catch()` handler
- Error callbacks that receive an error argument but never inspect or propagate it

## What to do
- Log the error with sufficient context (operation name, input identifiers) at the appropriate severity level
- Re-throw or wrap the error when the current layer cannot meaningfully recover, so callers can handle it
- For async code, ensure every `await` is inside a `try/catch` or the calling function returns the promise to a handler that catches

## Exceptions
- Intentional fire-and-forget operations where failure is non-critical, provided a comment explicitly documents why the error is discarded (e.g., `// best-effort telemetry, failure is non-blocking`)
