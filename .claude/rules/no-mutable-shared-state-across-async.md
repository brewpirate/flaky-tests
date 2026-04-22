---
slug: no-mutable-shared-state-across-async
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - security
  - concurrency
manifest:
  install_path: .claude/rules/no-mutable-shared-state-across-async.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  Race conditions on shared mutable state in concurrent contexts
=======
  Shared mutable state across async boundaries creates race conditions that are nearly impossible to reproduce in testing and manifest as intermittent corruption in production. All cross-boundary state must use synchronization primitives or immutable patterns.
trigger_phrase:
  haiku: "shared mutable state async"
  opus: "shared mutable state async race condition"
  sonnet: "mutable shared state async race condition"
>>>>>>> Stashed changes
---

# No Mutable Shared State Across Async Boundaries

## What to flag
- Module-level or global variables that are read and written from multiple async handlers, worker threads, or concurrent requests without synchronization
- In-memory caches (plain objects, Maps, arrays) mutated by request handlers without a locking mechanism or atomic update pattern
- Class instances stored as singletons that accumulate per-request state (e.g., pushing to an array on every request without clearing)
- Shared database connection or socket references modified during async operations without connection pooling

## What to do
- Use request-scoped or context-scoped state instead of shared globals; pass state explicitly through function arguments or async context APIs (`AsyncLocalStorage` in Node.js, `contextvars` in Python)
- Protect genuinely shared resources with mutexes, semaphores, or atomic operations appropriate to the runtime (e.g., `Mutex` in Rust, `asyncio.Lock` in Python, `Atomics` in JS workers)
- Prefer immutable data structures or copy-on-write patterns so concurrent readers are never affected by in-progress writes

## Exceptions
- Read-only configuration objects frozen at startup (`Object.freeze()` or equivalent) that are never mutated after initialization
- Metrics counters using atomic increment operations specifically designed for concurrent access (e.g., `prom-client` gauges, `AtomicInteger`)
