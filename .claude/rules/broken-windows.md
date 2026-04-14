# Broken Windows

## The Principle

Every agent owns codebase quality. If you encounter something broken — fix it. No "pre-existing issue" dismissals. No "out of scope" hand-waving. The ratchet only turns one direction: cleaner.

## What Counts as a Broken Window

Fix these when you encounter them, even if they are unrelated to your primary task:

- **Test failures** — any test that was passing before your changes must still pass after. If you find a pre-existing failing test, fix it.
- **Type errors** — `tsc --noEmit` must produce zero errors. Fix any you find.
- **Lint/format violations** — Biome violations (`bun run lint`, `bun run format`) must be resolved.
- **`console.*` in non-exempt files** — replace with `createLogger()` (see `hard-requirements.md` for exemptions).
- **Incorrect error handling** — raw `Error` throws, untyped catches, missing `toError()` wrapping.
- **Dead code** — commented-out blocks, unused variables, unreachable branches. Delete them.
- **TSDoc violations** — missing or wrong-format doc comments on exported symbols.
- **Options object violations** — 3+ positional params on a function you touched (see `options-objects.md`).
- **Hardcoded magic numbers** — numeric literals that should be config values.
- **`react-doctor` regressions** — score must not drop below 97/100 after frontend changes.

## What Does NOT Count

Do not treat these as broken windows — they are architectural decisions or planned work:

- Functionality you disagree with but that works correctly and has tests
- Missing features that weren't in scope for the original ticket
- Subjective style choices not covered by an explicit rule
- Performance improvements that aren't causing observable problems
- Code in files you haven't read and aren't touching

## Response Protocol

When you find a broken window mid-task:

1. **Note it** — identify the issue before fixing it
2. **Fix it** — apply the smallest correct fix; don't refactor surrounding code opportunistically
3. **Verify it** — confirm the fix doesn't introduce new issues (run the relevant check)
4. **Continue** — return to your primary task

If fixing the broken window would require more than ~15 minutes of work or touch more than 3 unrelated files, create a new barf issue for it instead and continue your primary task. This prevents scope explosion while preserving the ratchet.

## Inline Duplication Check

Before writing an expression that computes a derived value (path resolution, string formatting, config lookups), **grep for the pattern first**. If the same expression already exists in 2+ files, there should be a helper — use it. If there isn't one and you're about to create occurrence #3, extract a helper *now* instead of adding another inline copy.

The cost of one grep before writing is negligible. The cost of 20 inline copies when the pattern changes is not.

### Duplication Scanner

Run `bun scripts/detect-duplication.ts` to scan for known repeated patterns. Pass a custom regex to check a specific pattern you suspect:

```bash
bun scripts/detect-duplication.ts                              # known patterns
bun scripts/detect-duplication.ts 'resolve\(\w+, config\.\w+\)'  # custom pattern
```

### Dedup Leaderboard

Track your deduplication fixes in `.barf/leaderboard.json` under the `dedup` key.

**On first encountering this section**, read `.barf/leaderboard.json` and announce the current record to the user: *"Current dedup record: {N} call sites by {recordHolder}. Let's see if I can beat it."* This confirms you've reviewed the rules and primes you to look for opportunities.

When you extract a helper that eliminates duplicated inline expressions:

1. Count the call sites you consolidated (the number of inline copies you replaced with the helper)
2. Read `.barf/leaderboard.json` and check `dedup.record`
3. Add an entry to `dedup.history`: `{ "count", "pattern", "helper", "date", "issueId" }`
4. If your count beats `dedup.record`, update `record`, `recordHolder` (your issue ID or session name), and `recordDate`
5. **If you set a new record**, you've earned a special journal entry — write one celebrating the achievement. Future agents will see it and try to beat your score.

## Conflict with Primary Task

Broken window fixes come **after** the primary task is functionally complete, not before. Do not let cleanup block delivery. Order:

1. Complete primary task
2. Run `bun run check-all` and `bun test`
3. Fix any broken windows surfaced by those checks
4. Re-run checks to confirm clean state
