---
slug: plugin-no-core-mutation
type: rule
version: 1.0.0
scope: agent
severity: block
tags:
  - plugin-architecture
  - encapsulation
manifest:
  install_path: .claude/rules/plugin-no-core-mutation.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  Plugins extend through hooks and registries; never modify core internals directly
=======
  Plugins that monkey-patch or directly mutate core internals create invisible coupling that breaks on core upgrades and produces impossible-to-diagnose bugs from conflicting mutations. Extension through hooks and registries keeps the core stable and plugin behavior predictable and composable.
trigger_phrase:
  haiku: "plugin no core mutation"
  opus: "plugin no core mutation hooks only"
  sonnet: "plugin no core mutation hooks only"
>>>>>>> Stashed changes
---

# Plugins Must Not Mutate Core Internals

## What to flag
- Plugins that monkey-patch core classes, prototypes, or module exports
- Direct modification of core configuration objects rather than using provided extension APIs
- Plugins that replace core middleware, handlers, or routes by overwriting references
- Accessing private or underscore-prefixed members of the host application

## What to do
- Use the host's extension points (hooks, event emitters, registries) to add behavior
- Request new extension points from the core team rather than working around missing APIs
- Keep plugin behavior additive; wrap or decorate rather than replace

## Exceptions
- Official adapter plugins maintained by the core team may access internal APIs when no public extension point exists yet
