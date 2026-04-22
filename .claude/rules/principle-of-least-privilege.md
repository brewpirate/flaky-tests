---
slug: principle-of-least-privilege
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - security
  - permissions
manifest:
  install_path: .claude/rules/principle-of-least-privilege.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  Functions, modules, agents request only permissions they actually need
=======
  Overly broad permissions turn every minor vulnerability into a full system compromise — a read-only service with write access becomes a data-corruption vector when exploited. Every function, module, and agent must request the minimum permissions required for its actual operations.
trigger_phrase:
  haiku: "least privilege minimum permissions"
  opus: "least privilege minimum permissions security"
  sonnet: "least privilege minimum permissions access"
>>>>>>> Stashed changes
---

# Principle of Least Privilege

## What to flag
- IAM policies, OAuth scopes, or API key permissions broader than what the service actually uses (e.g., `s3:*` when only `s3:GetObject` on a single bucket is needed)
- Database connection roles with `SUPERUSER`, `CREATE`, or `DROP` privileges when only `SELECT`/`INSERT` on specific tables is required
- File system access patterns that read from or write to root-level directories instead of scoped application paths
- Agent or LLM tool definitions that expose destructive operations (delete, execute, admin) without gating on confirmation or role checks

## What to do
- Audit every permission grant and reduce it to the minimum set required for the feature to function; document why each permission exists
- Use separate credentials or roles for read-only vs. read-write operations and for different deployment environments
- Apply time-bounded or session-scoped tokens instead of long-lived credentials wherever the platform supports it

## Exceptions
- CI/CD service accounts that legitimately need broad deployment permissions, provided they are restricted to the pipeline runner and audit-logged
- Local development environments where convenience overrides production hardening, as long as the production configuration enforces strict scoping
