---
slug: plugin-explicit-lifecycle
type: rule
version: 1.0.0
scope: agent
severity: block
tags:
  - plugin-architecture
  - lifecycle
manifest:
  install_path: .claude/rules/plugin-explicit-lifecycle.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  Plugins declare init, register, and teardown hooks; no implicit startup side effects
=======
  Plugins with import-time side effects execute unpredictably based on module load order and leak resources when unloaded. Explicit lifecycle hooks give the host deterministic control over plugin initialization and teardown, preventing resource leaks and ordering bugs.
trigger_phrase:
  haiku: "plugin lifecycle hooks init teardown"
  opus: "plugin explicit lifecycle init teardown"
  sonnet: "plugin explicit lifecycle hooks init teardown"
>>>>>>> Stashed changes
---

# Plugins Must Declare Explicit Lifecycle Hooks

## What to flag
- Plugin modules that execute side effects at import time (e.g., starting listeners, modifying global state on load)
- Plugins without a defined initialization function or registration entry point
- Plugins that allocate resources (connections, file handles, timers) without a corresponding teardown hook
- Plugins that rely on module load order to function correctly

## What to do
- Implement explicit init(), register(), and teardown() hooks that the host calls at defined lifecycle points
- Move all setup logic out of module-level execution and into the init hook
- Ensure teardown releases every resource acquired during init

## Exceptions
- Declarative plugins that only export configuration objects and perform no runtime setup do not need teardown hooks
