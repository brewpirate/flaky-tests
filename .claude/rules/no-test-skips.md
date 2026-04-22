---
slug: no-test-skips
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - testing
  - ci
  - discipline
manifest:
  install_path: .claude/rules/no-test-skips.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  .skip, xit, xdescribe left in codebase are banned
=======
  Skipped tests are invisible broken windows — they accumulate silently, erode coverage, and mask regressions that would otherwise be caught. Any .skip, xit, or xdescribe left in the codebase means a known gap in verification that will eventually bite in production.
trigger_phrase:
  haiku: "no test skips banned"
  opus: "no test skips in codebase"
  sonnet: "no skipped tests banned"
>>>>>>> Stashed changes
---

# No Skipped Tests in Codebase

## What to flag
- `describe.skip`, `it.skip`, `test.skip`, or `.only` left in committed test files
- `xit`, `xdescribe`, `xtest`, `xcontext` markers in any test suite
- `@pytest.mark.skip`, `@unittest.skip`, `@Ignore`, `@Disabled` annotations without a linked tracking issue
- `pending` blocks in RSpec or `skip()` calls in Go tests without an expiration comment

## What to do
- Remove the skip marker and fix the underlying test so it passes
- If the test genuinely cannot run yet, replace the skip with a tracked issue reference and a TODO comment containing the issue URL and expected resolution date
- Configure CI to fail the build when any skip marker is detected without an approved exemption comment

## Exceptions
- Platform-specific tests that are conditionally skipped based on runtime detection (e.g., `skipIf(os.platform !== 'linux')`) with a clear reason
