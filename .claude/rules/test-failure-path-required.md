---
slug: test-failure-path-required
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - testing
  - error-handling
manifest:
  install_path: .claude/rules/test-failure-path-required.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  Every function that can fail has tests for invalid input and error conditions
=======
  Code that only tests the happy path silently accepts any error-handling regression — a thrown exception might become a swallowed null, a 500 might replace a 404, and nobody notices until users do. Every function that can fail must have tests verifying it fails correctly with invalid input, missing data, and downstream errors.
trigger_phrase:
  haiku: "test failure paths required"
  opus: "test failure paths required"
  sonnet: "failure path tests required error conditions"
>>>>>>> Stashed changes
---

# Failure Path Tests Required

## What to flag
- Functions that throw, return errors, or reject promises but have no test asserting the error type, message, or status code
- Endpoints that return 4xx/5xx responses for invalid input but lack tests verifying those status codes and error bodies
- Try/catch blocks or error-handling branches in production code with no corresponding test exercising that branch
- Validation logic (schema checks, auth guards, permission checks) that is never tested with invalid data

## What to do
- For each error path, write a test that supplies the triggering input and asserts the specific error type, message, or code
- Test all documented error codes an endpoint can return (400, 401, 403, 404, 409, 422, 500) with appropriate payloads
- Verify that error responses do not leak stack traces, internal paths, or sensitive data

## Exceptions
- Panic/fatal handlers that intentionally crash the process, where testing would require process-level harnesses outside the normal test runner
