---
trigger_phrase:
  haiku: "zod typescript tsdoc enforcement"
  opus: "zod4 strict tsdoc pino biome gates"
  sonnet: "non-negotiable code standards enforcement"
---

# Hard Requirements

These requirements are **non-negotiable**. Violations must be flagged and corrected immediately.

## Technology Versions

### Zod 4.x (MANDATORY)

**Rule**: All schema validation MUST use Zod ^4.0.0. Zod 3.x is prohibited.

```typescript
// CORRECT
import { z } from 'zod';  // version ^4.0.0

// WRONG - Do not use Zod 3
import { z } from 'zod';  // version ^3.x.x
```

**Enforcement**:

- Check `package.json` for `"zod": "^4.0.0"`
- Flag any import of Zod without version verification

### TypeScript 5.7+ Strict Mode (MANDATORY)

**Rule**: TypeScript must be 5.7+ with strict mode enabled.

**Enforcement**:

- `tsconfig.json` must have `"strict": true`
- See `typescript-patterns.md` for detailed TypeScript rules (no `any`, explicit return types, etc.)

## TSDoc Comments

Use **TSDoc** format (the TypeScript standard), not JSDoc closure style. Types are provided by the TypeScript signature — never repeat them in tags.

**Rule**: All exported symbols must have a `/** */` block comment explaining WHY/context, not just restating the signature.

**Rule**: `@param name - desc` (TSDoc style, no `{Type}` in the tag). Required when purpose is non-obvious from name and type alone.

**Rule**: `@returns` recommended when the return value needs explanation beyond what the type signature shows.

**Rule**: Extra context goes in the body text before tags. Do not use `@remarks` — it is not part of this codebase's convention.

**Rule**: Use `{@link SymbolName}` for cross-references to types, functions, or constants defined in this codebase. No display-text variant needed.

**Rule**: `@example` required on abstract methods to show call-site usage. Optional elsewhere.

**Recommended**: `@throws` for exported functions that throw typed errors (e.g., `@throws InvalidTransitionError when the transition is not permitted`).

**NOT required**: `@typeParam` (generics are self-documenting from the signature), `@public`/`@internal` (TypeScript `export` handles visibility).

```typescript
// WRONG - JSDoc closure style (type annotation in tag)
/**
 * @param {Issue} issue - The issue
 * @returns {Promise<Issue>} the result
 */
export function transition(issue: Issue, next: IssueState): Promise<Issue> { ... }

// WRONG - Restates the signature, adds no context
/** Transitions an issue to a new state. */
export function transition(issue: Issue, next: IssueState): Promise<Issue> { ... }

// CORRECT - TSDoc style, explains WHY, documents context
/**
 * Validates and applies a state transition, enforcing the {@link VALID_TRANSITIONS} machine.
 * Call this instead of mutating `issue.state` directly to preserve invariants.
 *
 * @param issue - The issue whose state will change
 * @param next - Target state; must be reachable from `issue.state`
 */
export function transition(issue: Issue, next: IssueState): Promise<Issue> { ... }
```

**Enforcement**:

- Every exported function, class, method, and type alias needs a `/** */` doc comment
- `@param {Type}` closure-style annotations are a violation — type comes from the signature
- `{@link}` required when referencing a symbol defined in this codebase
- Abstract methods must include `@example`
- TypeDoc runs with `validation: { notExported: true, invalidLink: true }` — broken `{@link}` references are CI failures

## Logging

### Rule: `createLogger()` Only — Never `console.*`

All logging must use `createLogger(moduleName)` from `@barf/core/utils/logger` (pino, JSON to stderr + log file). Use `LOG_PRETTY=1` in dev for readable output.

Biome enforces `noConsole: error` — this is also a CI gate.

**Exceptions**: server startup banner (`server.ts`), build scripts (`build.ts`), and frontend error boundary (`ErrorBoundary.tsx`) may use `console.*` where pino is unavailable or inappropriate.

### Log Level Guidelines

| Level | When to Use | Examples |
|-------|-------------|---------|
| `error` | Operation **failed**, needs attention | Provider I/O failure, unhandled exception, worker crash |
| `warn` | **Degraded** but recoverable | Rate limit hit (will retry), context threshold approaching, stale lock |
| `info` | **Significant lifecycle** events | Server start, issue state transition, session start/stop, build complete |
| `debug` | **Diagnostic** detail | Token counts, file paths resolved, timing measurements, config values |

### Structured Logger Context

Always include relevant IDs. Use `err` (not `error`) for error objects:

```typescript
// CORRECT
logger.info({ issueId, sessionId }, 'Build started')
logger.error({ err: toError(error), issueId }, 'Build failed')
logger.debug({ tokens: 1500, contextPct: 45 }, 'Token update')

// WRONG — string interpolation
logger.info(`Build started for issue ${issueId}`)

// WRONG — wrong key name
logger.error({ error: error }, 'Build failed')  // use 'err' not 'error'
```

## No Commented-Out Code

Delete dead code — git has history. No `// const oldThing = ...` blocks, no `// TODO: remove` left behind. If code is removed, remove it completely.

## Biome Enforcement

These rules are enforced by Biome linter (`biome.json`) and are CI gates:
- `noConsole: error`
- `noNestedTernary: error`
- `noUselessTernary: error`
- `noUselessTypeConstraint: error`

## Violation Response

When a hard requirement violation is detected:

1. **Stop** - Do not proceed with the current task
2. **Flag** - Clearly identify the violation
3. **Fix** - Correct the violation before continuing
4. **Verify** - Ensure the fix meets the requirement
