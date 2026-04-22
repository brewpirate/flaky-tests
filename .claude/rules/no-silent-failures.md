---
slug: no-silent-failures
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - resilience
  - observability
  - error-handling
manifest:
  install_path: .claude/rules/no-silent-failures.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  Failures must log, throw, or surface — never disappear
=======
  Silent failures — returning defaults without logging, swallowing exceptions, returning 200 on partial failure — make bugs invisible until they compound into data corruption or customer-visible outages. Every failure must leave an observable trace so problems are caught early, not discovered in post-mortems.
trigger_phrase:
  haiku: "no silent failures always log"
  opus: "no silent failures surface all errors"
  sonnet: "no silent failures log throw or surface"
>>>>>>> Stashed changes
---

# No Silent Failures

## What to flag
- Functions that return `null`, `undefined`, or a default value on failure without logging or signaling the error condition
- Catch blocks that swallow exceptions and return a fallback as though nothing went wrong
- Conditional branches that silently skip operations when preconditions are not met (e.g., `if (!user) return;` without logging)
- API endpoints that return 200 OK when an internal operation partially failed

## What to do
- At minimum, log the failure with context: what operation failed, what input triggered it, and what fallback (if any) was used
- Prefer throwing or returning an error type (Result, Either, error tuple) so the caller knows something went wrong
- For partial failures in batch operations, collect and report all failures rather than stopping at the first or ignoring them

## Exceptions
- Guard clauses that validate optional/expected-absent inputs (e.g., early return when an optional feature flag is off) — these are control flow, not failures
