---
trigger_phrase:
  haiku: "options objects over positional parameters"
  opus: "options object over positional params"
  sonnet: "options object over positional params"
---

# Options Objects Over Positional Parameters

Functions with more than 2 parameters MUST use a single options object instead of positional arguments.

## Rule

```typescript
// WRONG — positional parameters
async function triageIssue(
  issueId: string,
  config: Config,
  provider: IssueProvider,
  db?: Database,
  sessionId?: string,
): Promise<void> { ... }

// WRONG — positional + trailing opts bag (two-tier pattern)
async function triageIssue(
  issueId: string,
  config: Config,
  provider: IssueProvider,
  opts?: { db?: Database; sessionId?: string },
): Promise<void> { ... }

// CORRECT — single options object
async function triageIssue(opts: {
  issueId: string
  config: Config
  provider: IssueProvider
  db?: Database
  sessionId?: string
}): Promise<void> { ... }
```

## When This Applies

- **3+ parameters**: Convert to an options object. Functions with 1–2 parameters are fine as positional.
- **Exported functions**: Always use options objects when 3+ params — callers benefit the most.
- **Internal/private functions**: Same rule. Consistency reduces cognitive overhead and makes future extraction easier.
- **Callbacks and event handlers**: Short callbacks like `(id, state) => void` are exempt — the positional form is clearer for 1–2 arg signatures.

## Why

- **Readability at call sites**: `triageIssue({ issueId, config, provider })` is self-documenting; `triageIssue(issueId, config, provider)` requires memorizing parameter order.
- **Non-breaking extensibility**: Adding an optional field to an options object is a backwards-compatible change. Adding a positional parameter shifts existing call sites.
- **Eliminates trailing opts bags**: The two-tier pattern (`required positional + optional bag`) forces callers to reason about which tier a parameter belongs to. A flat options object removes this distinction.

## Interface Naming

Name the options interface after the function: `FunctionNameOpts`.

```typescript
export interface TriageIssueOpts {
  issueId: string
  config: Config
  provider: IssueProvider
  db?: Database
}

export async function triageIssue(opts: TriageIssueOpts): Promise<void> { ... }
```

For internal (non-exported) functions, inline the object type in the signature rather than creating a named interface.

## Destructuring

Destructure at the top of the function body, not in the parameter list:

```typescript
// CORRECT
async function triageIssue(opts: TriageIssueOpts): Promise<void> {
  const { issueId, config, provider, db } = opts
  // ...
}

// WRONG — destructuring in parameter hides the type name
async function triageIssue({ issueId, config, provider, db }: TriageIssueOpts): Promise<void> {
  // ...
}
```
