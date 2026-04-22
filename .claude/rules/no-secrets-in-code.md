---
slug: no-secrets-in-code
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - security
  - secrets
  - credentials
manifest:
  install_path: .claude/rules/no-secrets-in-code.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  Hardcoded keys, tokens, passwords, connection strings — zero tolerance
=======
  A single hardcoded credential in source code can compromise an entire system, and once committed to git history it persists even after deletion. All secrets must flow through environment variables or a dedicated secrets manager, never appear as string literals in source.
trigger_phrase:
  haiku: "hardcoded secrets credentials"
  opus: "hardcoded secrets credentials tokens"
  sonnet: "hardcoded secrets credentials code"
>>>>>>> Stashed changes
---

# No Secrets in Code

## What to flag
- String literals matching API key patterns (e.g., `sk-`, `AKIA`, `ghp_`, `Bearer <token>`)
- Variables named `password`, `secret`, `api_key`, `token`, `conn_string` assigned to literal values
- Base64-encoded blobs embedded directly in source that decode to credentials or keys
- `.env` values copy-pasted into config files, docker-compose files, or CI manifests

## What to do
- Move all secrets to environment variables or a dedicated secrets manager (Vault, AWS Secrets Manager, 1Password CLI)
- Reference secrets by name only: `process.env.DATABASE_URL`, not the actual connection string
- Add patterns to `.gitignore` and configure pre-commit hooks (e.g., `detect-secrets`, `gitleaks`) to block accidental commits

## Exceptions
- Example/placeholder values in documentation that are clearly fake (e.g., `sk-EXAMPLE-DO-NOT-USE`)
- Test fixtures using deterministic dummy values that never touch real services
