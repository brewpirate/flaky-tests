---
trigger_phrase:
  haiku: "optional deps testability pattern"
  opus: "optional deps real defaults mock tests"
  sonnet: "optional deps real defaults testability"
---

# Dependency Injection

## Pattern: Optional `*Deps` with Real Defaults

All orchestration functions accept an optional deps parameter. Real implementations are used when omitted; mocks are passed in tests.

```typescript
// Definition
export type RunLoopDeps = {
  agentRuntime?: AgentRuntimePlugin
  verifyIssue?: typeof verifyIssue
  runPreComplete?: typeof runPreComplete
  projectCwd?: string
  abortSignal?: AbortSignal
  db?: Database
}

export async function runLoop(
  issueId: string,
  mode: BarfMode,
  config: Config,
  provider: IssueProvider,
  deps: RunLoopDeps = {},
): Promise<void> {
  // Resolve defaults
  const agentRuntime = deps.agentRuntime ?? registry.resolve(config.agentRuntime)
  const database = deps.db ?? openWorkerDb(config.barfDir)
  // ...
}
```

## Naming: `*Deps` vs `*Opts`

- **`FunctionNameDeps`** — injectable **behavior** (functions, services, connections). Used for testability.
- **`FunctionNameOpts`** — **configuration** (settings, flags, IDs). Used for call-site readability.

Examples from the codebase:
- `RunLoopDeps` — injects agentRuntime, verifyIssue, db
- `AutoDeps` — injects triageIssue, agentRuntime, auditDeps
- `AuditDeps` — injects execFn, audit provider
- `TriageIssueOpts` — passes issueId, config, provider (configuration, not injectable behavior)

## Rule: No Globals

All state is passed as function arguments. Never use module-level mutable state for issue IDs, modes, or configuration. Historical context: `ISSUE_ID`/`MODE`/`ISSUE_STATE` as globals were the source of critical bugs in the original bash implementation.

## Injectable Function References

Use `typeof` to type injectable function overrides:

```typescript
export type AutoDeps = {
  triageIssue?: typeof triageIssue    // same signature as the real function
  verifyIssue?: typeof verifyIssue
  agentRuntime?: RunLoopDeps['agentRuntime']
}
```

## Injectable Resources

Common injectable resources:
- `db?: Database` — SQLite connection (worker-provided)
- `abortSignal?: AbortSignal` — cooperative cancellation
- `execFn?: typeof execFileNoThrow` — subprocess execution (for mocking in tests)

## Testing with DI

```typescript
// Pass mock implementations via deps
const mockRuntime: AgentRuntimePlugin = {
  name: 'mock',
  runIteration: async () => ({ outcome: 'success', tokens: 10, outputTokens: 5 }),
}

await autoCommand(provider, options, config, {
  triageIssue: async () => {},  // skip triage in this test
  agentRuntime: mockRuntime,
  db: testDatabase,
})
```
