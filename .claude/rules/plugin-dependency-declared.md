---
slug: plugin-dependency-declared
type: rule
version: 1.0.0
scope: agent
severity: block
tags:
  - plugin-architecture
  - dependency-management
manifest:
  install_path: .claude/rules/plugin-dependency-declared.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  Plugins declare dependencies on other plugins explicitly; no implicit load order assumptions
=======
  Undeclared plugin dependencies cause silent failures when loading order changes or a required plugin is absent. Explicit dependency declarations let the host resolve load order automatically and report missing dependencies at startup rather than at runtime.
trigger_phrase:
  haiku: "plugin dependencies explicitly declared"
  opus: "plugin dependencies explicitly declared"
  sonnet: "plugin dependencies explicitly declared"
>>>>>>> Stashed changes
---

# Plugin Dependencies Must Be Declared

## What to flag
- Plugins that import or reference other plugins without listing them as dependencies in metadata
- Plugin initialization that fails silently when an expected peer plugin is absent
- Reliance on alphabetical or insertion-order loading to ensure a dependency initializes first
- Plugins that assume global state set up by another plugin without declaring the relationship

## What to do
- Declare all plugin dependencies in the plugin's manifest or metadata configuration
- Have the host's plugin loader resolve dependency order and report missing dependencies at startup
- Fail fast with a clear error message when a declared dependency is not available

## Exceptions
- Optional enhancements that gracefully degrade when a peer plugin is absent may use optional dependency declarations
