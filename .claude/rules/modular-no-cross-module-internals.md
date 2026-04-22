---
slug: modular-no-cross-module-internals
type: rule
version: 1.0.0
scope: agent
severity: block
tags:
  - modular-architecture
  - encapsulation
  - boundaries
manifest:
  install_path: .claude/rules/modular-no-cross-module-internals.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  Modules import only from each other's public API, never internal paths
=======
  Importing another module's internals creates brittle coupling to implementation details that can change without notice. Restricting cross-module access to public APIs preserves encapsulation and allows modules to refactor internals freely without breaking consumers.
trigger_phrase:
  haiku: "no cross-module internal imports barrel only"
  opus: "no cross-module internal imports public api only"
  sonnet: "no cross-module internal imports use public api"
>>>>>>> Stashed changes
---

# No Cross-Module Internal Imports

## What to flag
- Import statements that reach into another module's internal directory structure (e.g., `import { validate } from '@modules/auth/services/internal/tokenValidator'`)
- Code referencing another module's private types, helper functions, or implementation details not exported from the module's barrel
- Deep path imports crossing module boundaries that bypass the public API entry point (e.g., `../../billing/repositories/invoiceRepo`)
- Type imports from another module's internal files that tightly couple modules at the implementation level

## What to do
- Rewrite all cross-module imports to reference only the target module's public API barrel file (e.g., `import { validateToken } from '@modules/auth'`)
- If needed functionality is not exposed in the target module's public API, request it be added to the barrel rather than importing internals
- Use lint rules or import restrictions (e.g., eslint no-restricted-imports, TypeScript paths) to enforce module boundary imports at build time

## Exceptions
- Shared kernel or common library modules explicitly designed to expose internal utilities to all modules
- Integration or end-to-end test setups that need access to internals for test fixtures or seeding
