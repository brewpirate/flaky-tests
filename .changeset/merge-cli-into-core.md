---
'@flaky-tests/core': major
---

Merge `@flaky-tests/cli` into `@flaky-tests/core` (closes #64).

The detection CLI now ships as the `flaky-tests` bin from `@flaky-tests/core`.
`@flaky-tests/cli` will be deprecated on npm with a pointer to core.

**Migration:**

```diff
- bunx @flaky-tests/cli
+ bunx @flaky-tests/core
```

```diff
# package.json
- "@flaky-tests/cli": "^0.1.0"
+ "@flaky-tests/core": "^1.0.0"
```

CLI helpers (`generatePrompt`, `generateHtml`, `createIssue`, `findExistingIssue`,
`resolveRepo`, `copyToClipboard`) are now exported from `@flaky-tests/core/cli`.

Stores continue to be resolved via dynamic import at runtime — install whichever
store package you need alongside `@flaky-tests/core`. The previous
`optionalDependencies` hints carried by `@flaky-tests/cli` have been dropped
since they were never load-bearing.
