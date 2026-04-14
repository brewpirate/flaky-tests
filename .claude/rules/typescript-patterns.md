# TypeScript Patterns

## Enforced Patterns (Active in Codebase)

### No `any` Type

Use `unknown` with Zod validation or type guards.

```typescript
// WRONG
function processData(data: any) { return data.value }

// WRONG — unsafe cast
function processData(data: unknown) { return (data as Issue).title }

// CORRECT — Zod validation
function processData(data: unknown): Issue {
  return IssueSchema.parse(data)
}

// CORRECT — type guard
function isIssue(data: unknown): data is Issue {
  return IssueSchema.safeParse(data).success
}
```

### No `@ts-ignore` — Use `@ts-expect-error` with Justification

```typescript
// WRONG
// @ts-ignore
const result = bunSpecificApi()

// CORRECT — with explanation
// @ts-expect-error — Bun embeds .css text imports; tsc lacks declaration
import styles from './styles.css' with { type: 'text' }
```

### Explicit Return Types on Exported Functions

```typescript
// WRONG
export function parseIssue(content: string) { ... }

// CORRECT
export function parseIssue(content: string): Issue { ... }
```

### `as const` for Constants

Used in ~20 files. Preserves literal types and enables type derivation.

```typescript
const ISSUE_STATES = ['NEW', 'GROOMED', 'PLANNED', 'BUILT', 'COMPLETE', 'STUCK', 'SPLIT'] as const
type IssueState = typeof ISSUE_STATES[number]

const ERROR_CODES = {
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
} as const
```

### `satisfies` for Type Checking Without Widening

```typescript
// Validates the shape while preserving literal types
const ICONS = {
  plan: 'clipboard',
  build: 'hammer',
  triage: 'search',
} as const satisfies Record<string, string>

ICONS.plan  // type: 'clipboard' (not string)
```

### Nullish Coalescing `??` Over Falsy `||`

```typescript
// WRONG — catches 0 and ''
const limit = options.limit || 20

// CORRECT — only catches null/undefined
const limit = options.limit ?? 20
```

**Exception**: `|| 0` is correct when guarding against `NaN` (e.g., `parseInt(value) || 0`), since `NaN ?? 0` does not catch `NaN`.

### Discriminated Unions via Zod

Prefer `z.discriminatedUnion()` over hand-written type unions. See `zod-schemas.md`.

## Patterns to Adopt

### `readonly` for Function Parameters

Prevent accidental mutation of arrays and objects passed to functions:

```typescript
function processIssues(issues: readonly Issue[]): IssueSummary {
  // issues.push(newIssue)  // ERROR: Cannot mutate
  return issues.reduce(...)
}
```

### Type Predicates for Runtime Narrowing

```typescript
function isContextOverflow(error: unknown): error is ContextOverflowError {
  return error instanceof AppError && error.code === 'CONTEXT_OVERFLOW'
}
```

### Exhaustive Switch with `never`

**REQUIRED for `IssueState`** — all switch statements on `IssueState` must include a `never` exhaustiveness check. See `zod-schemas.md` for the full pattern.

Recommended for other enums:

```typescript
function handleOutcome(outcome: IterationOutcome): void {
  switch (outcome) {
    case 'success': return
    case 'stuck': return
    case 'overflow': return
    case 'rate_limited': return
    default:
      const _exhaustive: never = outcome
      throw new Error(`Unhandled outcome: ${_exhaustive}`)
  }
}
```

### `any` in Tests

`as any` is acceptable in test files for intentionally constructing invalid states. Add a comment explaining why:

```typescript
// @ts-expect-error — intentionally testing invalid state transition
await transition(issue, 'INVALID_STATE' as any)
```
