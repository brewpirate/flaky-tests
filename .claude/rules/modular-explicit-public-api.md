---
slug: modular-explicit-public-api
type: rule
version: 1.0.0
scope: agent
severity: block
tags:
  - modular-architecture
  - encapsulation
  - public-api
manifest:
  install_path: .claude/rules/modular-explicit-public-api.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  Each module exposes an explicit index/barrel; internal files not importable from outside
=======
  Without an explicit public API surface, consumers reach into arbitrary internal files, creating invisible coupling that blocks refactoring. A barrel file defines the contract boundary, making it clear what is supported for external use and what can change freely.
trigger_phrase:
  haiku: "module barrel explicit public api"
  opus: "module explicit barrel public api encapsulation"
  sonnet: "module barrel file explicit public api"
>>>>>>> Stashed changes
---

# Modules Must Expose an Explicit Public API

## What to flag
- Modules lacking an `index.ts`, `index.js`, `mod.rs`, `__init__.py`, or equivalent barrel/entry file that defines the public surface
- External code importing directly from internal module paths (e.g., `import { helper } from '@modules/billing/internal/utils/helper'`) instead of the module's public entry point
- Barrel files that re-export everything with wildcard exports (`export * from './internal'`) defeating the purpose of encapsulation
- Module files that are all publicly accessible with no distinction between public and internal code

## What to do
- Create an explicit barrel file for each module that selectively exports only the types, functions, and classes intended for external use
- Configure path aliases, package.json `exports` field, or linter rules to prevent imports that bypass the barrel file
- Mark internal files with naming conventions (e.g., `internal/` subdirectory, `_` prefix) to reinforce that they are not part of the public API

## Exceptions
- Test files within the same module that need to import internal implementation details for unit testing
- Monorepo tooling or code generation scripts that must introspect module internals for build purposes
