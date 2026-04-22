---
slug: no-unvalidated-redirects
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - security
  - phishing
manifest:
  install_path: .claude/rules/no-unvalidated-redirects.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  Redirect targets must be whitelisted; open redirects are phishing vectors
=======
  Open redirects let attackers craft URLs on your trusted domain that silently bounce users to malicious sites, enabling credential phishing and OAuth token theft. All redirect targets must be validated against an allowlist of known-safe destinations.
trigger_phrase:
  haiku: "unvalidated redirect phishing"
  opus: "open redirect unvalidated phishing allowlist"
  sonnet: "unvalidated redirect open phishing allowlist"
>>>>>>> Stashed changes
---

# No Unvalidated Redirects

## What to flag
- HTTP redirects (3xx responses) where the target URL is taken directly from user input (`?redirect=`, `?next=`, `?returnTo=`) without validation
- Frontend `window.location` or `router.push` assignments using unverified query parameters or hash fragments
- Server-side redirect helpers (`res.redirect()`, `RedirectResponse()`) accepting full absolute URLs from request data
- OAuth/OIDC callback URLs that are not checked against a registered allowlist

## What to do
- Maintain an explicit allowlist of permitted redirect domains or path prefixes; reject anything not on the list
- Use relative paths for internal redirects and resolve them against the application origin before issuing the response
- Validate and normalize redirect URLs server-side: strip credentials, reject `javascript:` and `data:` schemes, and block redirects to external origins unless explicitly allowed

## Exceptions
- Admin-configured redirect rules stored in a trusted database, not derived from per-request user input
- Link shortener or proxy services where open redirection is the core product feature, provided rate limiting and abuse detection are in place
