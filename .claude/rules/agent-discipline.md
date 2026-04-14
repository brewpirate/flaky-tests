# Agent Discipline

## Output Anti-Patterns

These are red flags that indicate a task was not completed correctly. Avoid them.

### No TODOs in Delivered Code

Do not leave `// TODO`, `// FIXME`, or `// HACK` comments in code you submit. These indicate you punted on the hard parts. If something genuinely cannot be done within scope, document it in the issue or create a follow-up barf issue — don't leave a breadcrumb in the code.

### No Gold Plating

Only implement what was asked for. Do not add features, configuration options, abstractions, or improvements that weren't in the acceptance criteria. Extra output looks helpful but creates review burden, introduces unintended behavior, and violates the "focused context" principle: agents that stay on task produce better output than agents that range freely.

Specific forms of gold plating to avoid:
- Adding optional parameters or flags "for flexibility"
- Extracting abstractions for code you touched but weren't asked to refactor
- Adding logging, metrics, or observability beyond what the task required
- Writing tests for functionality adjacent to but outside the task scope

### No Test Weakening

Never delete, skip, or weaken a test to make the suite pass. This includes:
- Removing assertions that were failing
- Adding `// @ts-expect-error` to suppress type errors in tests
- Changing expected values to match broken behavior
- Wrapping test blocks in `if` conditions to skip them

If a test is failing and you don't know why, that is a signal to stop and investigate — not to neutralize the test. A passing suite with weakened tests is worse than a failing suite: it hides real problems.

### No Magic Values

Do not hardcode strings, numbers, or paths that belong in configuration. New config values go in `ConfigSchema` with a sensible default. See `naming-and-style.md` for the no-magic-numbers rule.

---

## STUCK Criteria

Declare an issue STUCK — do not keep retrying — when any of the following are true:

1. **The same failure occurs 2+ times with different approaches.** If you've tried two genuinely different approaches to the same problem and both fail, you've hit something that needs human attention. A third attempt is unlikely to succeed and wastes tokens.

2. **You've identified a blocker you cannot resolve.** External dependency unavailable, spec is contradictory, required context is missing from the issue. Name the blocker explicitly in the issue notes, then stop.

3. **Context overflow on a task that should be focused.** If context is exhausted on a task that should have been tractable, the task is too large. Do not attempt to summarize and continue — overflow is a signal that the issue needs splitting. Mark STUCK with a note suggesting how to split it.

When marking STUCK, always leave a clear note explaining:
- What you tried
- Where it failed
- What a human (or next agent) would need to unblock it
