---
slug: test-happy-path-required
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - testing
  - completeness
manifest:
  install_path: .claude/rules/test-happy-path-required.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  Every public function/endpoint has at least one valid input/output test
=======
  A public function without a happy-path test has zero verified behavior — any refactor or dependency change can silently break it with no signal. At minimum, every exported function and endpoint must have one test proving it works correctly with valid input.
trigger_phrase:
  haiku: "happy path test required"
  opus: "happy path test required"
  sonnet: "happy path test required"
>>>>>>> Stashed changes
---

# Happy Path Test Required for Every Public Function

## What to flag
- Public functions or methods whose name never appears in a test assertion with valid, representative input
- REST/GraphQL endpoints that lack a test sending a well-formed request and asserting a 2xx response with correct body shape
- Exported utility functions with no test demonstrating the primary intended use case
- New public surface introduced in a changeset without a corresponding "given valid input, returns expected output" test

## What to do
- Write at least one test per public function that supplies typical, valid arguments and asserts the correct return value or side effect
- For endpoints, send a realistic request body and verify status code, response schema, and key field values
- Place happy-path tests at the top of the test file so reviewers see intended behavior first

## Exceptions
- Abstract methods or interfaces that are tested through their concrete implementations
- Trivial getters/setters on data-transfer objects with no transformation logic
