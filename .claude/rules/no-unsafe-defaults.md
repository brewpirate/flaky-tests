---
slug: no-unsafe-defaults
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - security
  - configuration
manifest:
  install_path: .claude/rules/no-unsafe-defaults.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  No default credentials, no open CORS * without explicit justification
=======
  Unsafe defaults are the most common path from fresh deployment to breach — default credentials get forgotten, open CORS policies get inherited by production, and debug modes leak internals. Every configuration must default to the most restrictive safe value, with relaxation requiring explicit justification.
trigger_phrase:
  haiku: "unsafe defaults credentials cors"
  opus: "unsafe defaults cors credentials configuration"
  sonnet: "unsafe defaults credentials cors security"
>>>>>>> Stashed changes
---

# No Unsafe Defaults

## What to flag
- Default usernames or passwords in configuration files (e.g., `admin/admin`, `root/password`, `user/changeme`)
- CORS policies set to `Access-Control-Allow-Origin: *` without an explicit code comment justifying the decision
- Debug mode or verbose logging enabled by default in non-development configurations
- Default ports or endpoints left open without authentication middleware attached

## What to do
- Require all credentials to be set explicitly at deploy time; fail loudly on startup if they are missing
- Restrict CORS origins to an explicit allowlist loaded from environment configuration
- Ensure production configuration defaults are secure (debug off, TLS required, auth enforced) and development-only relaxations are gated by `NODE_ENV` or equivalent

## Exceptions
- Local development environments where CORS `*` is gated behind `NODE_ENV === 'development'` and cannot be activated in production
- Public, read-only APIs that intentionally serve unauthenticated traffic (must be documented in an ADR)
