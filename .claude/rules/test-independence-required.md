---
slug: test-independence-required
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - testing
  - isolation
manifest:
  install_path: .claude/rules/test-independence-required.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  No test relies on another having run first; each is fully self-contained
=======
  Tests that depend on execution order create phantom failures when run in isolation, in parallel, or in a different sequence — turning CI into a non-deterministic guessing game. Every test must be fully self-contained with its own setup and teardown so it passes regardless of what ran before it.
trigger_phrase:
  haiku: "test independence required"
  opus: "test independence required"
  sonnet: "test independence isolation required"
>>>>>>> Stashed changes
---

# Test Independence Required

## What to flag
- Tests that pass only when run in a specific order but fail when run in isolation or in random/shuffled order
- Shared mutable state between tests (e.g., a module-level variable mutated in one test and read in another) without per-test reset
- Tests that depend on rows, files, or resources created by a prior test instead of setting up their own fixtures
- `beforeAll`/`setupClass` blocks that create state consumed unevenly across tests, coupling them to execution order

## What to do
- Ensure every test creates its own preconditions in its setup phase and cleans up in its teardown phase
- Use per-test database transactions that roll back, or fresh in-memory instances, to guarantee isolation
- Run the test suite with randomized ordering enabled (e.g., `jest --randomize`, `pytest -p randomly`, `go test -shuffle=on`) and fix any failures

## Exceptions
- Explicitly ordered end-to-end scenario tests (e.g., a login-then-purchase workflow) that are grouped in a single test function or clearly documented as sequential steps
