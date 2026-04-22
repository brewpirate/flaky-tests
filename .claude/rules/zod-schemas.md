---
trigger_phrase:
  haiku: "zod schema first source of truth"
  opus: "zod schema first boundary validation"
  sonnet: "zod schema first source of truth"
---

# Zod Schemas

## Rule: Schema-First Development

Zod schemas are the **single source of truth** for data types. Never define TypeScript interfaces separately for data that crosses boundaries.

**Exemptions**: function option bags (`*Opts`, `*Deps`), DI interfaces (`AgentRuntimePlugin`, `IssueProviderCore`), and xstate machine types may use plain interfaces since they define behavior contracts, not validated data shapes.

```typescript
// WRONG — separate interface
interface Issue {
  id: string
  state: IssueState
  title: string
}

// CORRECT — type inferred from schema
const IssueSchema = z.object({
  id: z.string(),
  state: IssueStateSchema,
  title: z.string(),
})
type Issue = z.infer<typeof IssueSchema>
```

## Schema Location

Most schemas live in `packages/core/src/types/schema/` (23 files). Re-exported from `packages/core/src/types/index.ts`. `WorkerMessageSchema` lives in `packages/core/src/workers/protocol.ts`.

Key domain schemas:
- `IssueStateSchema` / `IssueSchema` — issue state machine and data
- `ConfigSchema` — `.barfrc` configuration
- `SessionSchema` / `SessionStatusSchema` — session lifecycle
- `ActivityEntrySchema` — SDK message → activity entries
- `VerifyResultSchema` — verification pass/fail
- `AuditResponseSchema` — audit findings
- `WorkerRequestSchema` — worker protocol

## ID Conventions

IDs are plain `z.string()` values with format conventions:
- **Issue IDs**: slug format (e.g., `001`, `fix-login-bug`)
- **Session IDs**: `{issueId}-{timestamp}` (e.g., `001-1710864923456`)
- **Auto run IDs**: `run-{ms}` (e.g., `run-1710864923456`)
- **PIDs**: `z.number().int().positive()`

## Discriminated Unions

Use `z.discriminatedUnion()` — the standard barf pattern. 8 schemas use this:

```typescript
// CORRECT — Zod discriminated union (different shapes per branch)
const AuditResponseSchema = z.discriminatedUnion('pass', [
  z.object({ pass: z.literal(true), findings: z.array(AuditFindingSchema) }),
  z.object({ pass: z.literal(false), findings: z.array(AuditFindingSchema), summary: z.string() }),
])

// WRONG — hand-written type union
type VerifyResult = { passed: true; failures: [] } | { passed: false; failures: VerifyFailure[] }
```

## Schema Composition

```typescript
// Extend an existing schema
const DetailedIssueSchema = IssueSchema.extend({
  comments: z.array(z.string()),
})

// Omit fields for creation input
const CreateIssueSchema = IssueSchema.omit({ id: true, state: true })

// Pick specific fields
const IssueSummarySchema = IssueSchema.pick({ id: true, title: true, state: true })
```

## Zod 4 Syntax

```typescript
// CORRECT — Zod 4 error customization
z.string().min(1, { error: 'Name is required' })

// WRONG — Zod 3 syntax
z.string().min(1, { message: 'Name is required' })
```

## Shared Schema Extraction

When the same schema pattern appears in 2+ places, extract to a shared schema:

```typescript
// BEFORE — repeated pattern
const SessionStartEventSchema = z.object({
  timestamp: z.string().datetime(),
})
const SessionEndEventSchema = z.object({
  timestamp: z.string().datetime(),
})

// AFTER — shared
const TimestampField = z.string().datetime()
```

## State Machine Discipline

If adding or removing an `IssueState`, you **MUST** update all of these:

1. `VALID_TRANSITIONS` in `packages/core/src/types/schema/issue-schema.ts`
2. All switch/if-else blocks that handle `IssueState` (use exhaustive `never` check)
3. Frontend state display components
4. Tests covering state transitions

```typescript
// REQUIRED — exhaustive check on IssueState
function getStateColor(state: IssueState): string {
  switch (state) {
    case 'NEW': return 'blue'
    case 'GROOMED': return 'yellow'
    case 'PLANNED': return 'orange'
    case 'BUILT': return 'green'
    case 'COMPLETE': return 'gray'
    case 'STUCK': return 'red'
    case 'SPLIT': return 'purple'
    default:
      const _exhaustive: never = state
      throw new Error(`Unhandled state: ${_exhaustive}`)
  }
}
```
