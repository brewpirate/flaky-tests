---
trigger_phrase:
  haiku: "typescript naming style conventions"
  opus: "typescript verbose naming readability conventions"
  sonnet: "verbose naming style rules"
---

# Naming and Style

## Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files (.ts) | kebab-case | `issue-service.ts` |
| Files (.tsx) | PascalCase | `ConfigPanel.tsx` (React convention) |
| Classes | PascalCase | `IssueProvider` |
| Functions | camelCase | `fetchIssueById` |
| Constants | SCREAMING_SNAKE | `MAX_RETRY_COUNT` |
| Interfaces | PascalCase (no I prefix) | `Issue`, not `IIssue` |
| Types | PascalCase | `IterationResult` |
| Zod schemas | PascalCase + Schema | `IssueSchema` |

## Verbose Names — No Abbreviations

Always use full, descriptive names. Never abbreviate.

```typescript
// WRONG — abbreviations and shorthand
const cfg = loadConfig()
const ctx = getContext()
const req = context.req
const res = await fetch(url)
const msg = 'Operation failed'
const cb = (error) => {}
const idx = items.indexOf(target)
const el = document.querySelector('.modal')
const evt = new CustomEvent('change')
const btn = document.querySelector('button')
const auth = getAuthState()

// CORRECT — full descriptive names
const config = loadConfig()
const context = getContext()
const request = context.req
const response = await fetch(url)
const message = 'Operation failed'
const handleError = (error) => {}
const index = items.indexOf(target)
const element = document.querySelector('.modal')
const event = new CustomEvent('change')
const button = document.querySelector('button')
const authentication = getAuthState()
```

### Self-Documenting Variables

```typescript
// WRONG
const cnt = issues.filter(issue => issue.state === 'NEW').length
const d = new Date()

// CORRECT
const newIssueCount = issues.filter(issue => issue.state === 'NEW').length
const createdAt = new Date()
```

### Function Names: Action + Subject

```typescript
// WRONG — vague or generic
function getItem(id: string) { ... }
function handle(data: unknown) { ... }
function process(issue: Issue) { ... }

// CORRECT — specific action + subject
function fetchIssueById(issueId: string) { ... }
function parseTriageResponse(data: unknown) { ... }
function validateTransition(issue: Issue) { ... }
```

### Boolean Naming: `is/has/should/can` Prefix

```typescript
// WRONG
const locked = checkLock(issueId)
const children = issue.children.length > 0
const retry = attemptCount < maxRetries

// CORRECT
const isLocked = checkLock(issueId)
const hasChildren = issue.children.length > 0
const shouldRetry = attemptCount < maxRetries
```

### Loop and Callback Variables: Name the Element

```typescript
// WRONG — single-char or generic names
issues.filter(x => x.state === 'NEW')
for (const i of items) { ... }
entries.map(e => e.timestamp)

// CORRECT — named elements
issues.filter(issue => issue.state === 'NEW')
for (const issue of issues) { ... }
entries.map(entry => entry.timestamp)
```

### Destructuring: Don't Rename to Abbreviations

```typescript
// WRONG
const { sessionId: sid, issueId: iid } = options

// CORRECT
const { sessionId, issueId } = options
```

**Exceptions**:
- Single-char index vars in numeric loops (`for (let i = 0; i < length; i++)`)
- Math/unit abbreviations in pure formatting functions (`s`, `m`, `h`, `d` for seconds/minutes/hours/days)

## Readability Over Cleverness

```typescript
// WRONG — clever one-liner
const status = issues.filter(issue => issue.state === 'STUCK').length > 0 ? 'degraded' : 'healthy'

// CORRECT — clear and scannable
const stuckIssues = issues.filter(issue => issue.state === 'STUCK')
const status = stuckIssues.length > 0 ? 'degraded' : 'healthy'
```

## One Operation Per Line

```typescript
// WRONG — hidden side effects
users.push(currentUser = await fetchUser(id))

// CORRECT — separate operations
const currentUser = await fetchUser(id)
users.push(currentUser)
```

## Explicit Over Implicit

```typescript
// WRONG — falsy check catches 0 and ''
if (value) { ... }
if (array.length) { ... }

// CORRECT — explicit checks
if (value !== null && value !== undefined) { ... }
if (array.length > 0) { ... }
```

## No Magic Numbers

Use config values from Zod-validated `ConfigSchema`. Never scatter numeric literals.

```typescript
// WRONG
if (retryCount > 3) { ... }

// CORRECT
if (retryCount > config.maxRetries) { ... }
```

**Acceptable**: universally understood values (`index + 1`, `percentage / 100`, `array.slice(0, 1)`).

## No Direct `process.env` Access

All configuration flows through `.barfrc` → `ConfigSchema.parse()` → `applyEnvFallbacks()`. Never read `process.env.X` in application code. If a new setting is needed, add it to `ConfigSchema` with a default; if it also needs an env-var override, add an entry to `ENV_FALLBACKS` in `packages/core/src/core/config.ts`.

The env fallback layer handles secrets and deployment-specific operational values including `SENTRY_DSN`, `LANGFUSE_*`, `OTEL_*`, `SIGNOZ_*`, and the logging vars `BARF_LOG_FILE` / `LOG_LEVEL` / `LOG_PRETTY`. `.barfrc` wins when both are set — env only applies when the config field is still at its schema default.

**Genuine exceptions** (read env directly — too early for `applyEnvFallbacks`):
- pre-config startup script paths
- build-time scripts (`packages/server/src/server/build.ts`, etc.)

## DRY: Extract at 3+ Repetitions

- Same logic in 3+ places → extract to shared utility
- Prefer composition over inheritance
- Don't abstract prematurely — inline until the pattern emerges
- DRY applies to **knowledge**, not just code: identical code in different domains may evolve separately

## Service Layer: Thin Routes

Routes handle HTTP concerns (parsing, status codes). Business logic lives in services.

```typescript
// CORRECT — thin route
app.post('/issues/:id/transition', async (context) => {
  const result = await issueService.transition(issueId, targetState)
  return context.json(result)
})
```

Biome auto-enforces: `noConsole`, `noNestedTernary`, `noUselessTernary`, `noUselessTypeConstraint`. See `hard-requirements.md` for details.
