---
slug: no-test-data-hardcoded-to-environment
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - testing
  - portability
manifest:
  install_path: .claude/rules/no-test-data-hardcoded-to-environment.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  Tests must not rely on specific local paths, ports, or environment state
=======
  Tests hardcoded to specific paths, ports, or environment variables pass on the original developer's machine and fail everywhere else — breaking CI, blocking teammates, and eroding trust in the suite. All test data must be self-contained or parameterized so tests run identically on any machine.
trigger_phrase:
  haiku: "no hardcoded paths ports in tests"
  opus: "no test data hardcoded to environment"
  sonnet: "no hardcoded test paths or ports"
>>>>>>> Stashed changes
---

# No Test Data Hardcoded to Environment

## What to flag
- Absolute file paths in test code (e.g., `/Users/john/project/fixtures/`, `C:\Users\...`) instead of path-relative references
- Hardcoded port numbers (e.g., `http://localhost:3000`) that will collide when tests run in parallel or in CI
- Tests that read from or write to well-known system directories (`/tmp/myapp`, `~/.config/myapp`) without cleanup or isolation
- Direct references to environment-specific hostnames, database connection strings, or API keys embedded as string literals

## What to do
- Use `path.join(__dirname, 'fixtures')`, `os.path.dirname(__file__)`, or equivalent to construct paths relative to the test file
- Allocate dynamic ports (bind to port 0 and read back the assigned port) or use the test framework's server helpers
- Read external configuration from environment variables with sensible defaults, never from hardcoded literals

## Exceptions
- Docker Compose-based integration test suites where service names and ports are defined in the compose file and documented as required infrastructure
