---
slug: plugin-isolated-failure
type: rule
version: 1.0.0
scope: agent
severity: block
tags:
  - plugin-architecture
  - fault-tolerance
manifest:
  install_path: .claude/rules/plugin-isolated-failure.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  One plugin failure must not crash the host; errors caught and isolated at plugin boundary
=======
  A single misbehaving plugin that crashes the host process takes down all other plugins and the host application with it. Isolation boundaries ensure plugin failures are contained, logged, and recoverable without affecting the rest of the system.
trigger_phrase:
  haiku: "plugin failure isolated host"
  opus: "plugin failure isolated host protected"
  sonnet: "plugin failure isolated host protected"
>>>>>>> Stashed changes
---

# Plugin Failures Must Be Isolated

## What to flag
- Plugin hook invocations without try/catch or error boundary wrapping in the host
- Plugins that throw unhandled exceptions into the host's main event loop or request pipeline
- Unguarded Promise rejections originating from plugin async operations
- Plugin errors that cause the host process to exit or enter an unrecoverable state

## What to do
- Wrap every plugin hook invocation in the host with error isolation (try/catch, error boundaries)
- Log plugin errors with full context and disable the failing plugin gracefully
- Implement a health-check mechanism that can detect and report degraded plugins

## Exceptions
- Plugins marked as critical in the host configuration may be allowed to halt startup if they fail to initialize
