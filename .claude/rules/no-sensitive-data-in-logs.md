---
slug: no-sensitive-data-in-logs
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - security
  - logging
manifest:
  install_path: .claude/rules/no-sensitive-data-in-logs.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  PII, tokens, passwords must never appear in log output
=======
  Logs are often stored in plain text, shipped to third-party aggregators, and accessed by broad teams — any PII, token, or password that leaks into log output becomes an uncontrolled exposure surface. Sensitive data must be redacted or excluded before logging.
trigger_phrase:
  haiku: "sensitive data logs pii"
  opus: "sensitive pii logs redaction"
  sonnet: "sensitive data logs redaction pii"
>>>>>>> Stashed changes
---

# No Sensitive Data in Logs

## What to flag
- Log statements that interpolate variables containing passwords, tokens, API keys, session IDs, or authorization headers
- Request/response logging middleware that dumps full headers (including `Authorization`, `Cookie`, `Set-Cookie`) or full bodies without redaction
- Error handlers that log the entire caught exception payload when it may contain user-submitted form data (emails, SSNs, credit card numbers)
- Stack traces in production logs that expose environment variables or connection strings

## What to do
- Build a redaction layer into the logging pipeline that masks known sensitive field names (`password`, `token`, `ssn`, `authorization`) before output
- Log references instead of values: use request IDs, user IDs, or correlation IDs to trace operations without exposing raw data
- Configure structured logging libraries to apply field-level allowlists so only approved fields are emitted

## Exceptions
- Debug-level logs in local development that are never shipped to a remote log aggregator and are excluded by log-level configuration in all deployed environments
- Deliberately logged token prefixes (first 4 characters) for support troubleshooting, provided the rest is masked
