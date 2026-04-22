---
slug: no-swallowed-type-errors
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - resilience
  - type-safety
  - correctness
manifest:
  install_path: .claude/rules/no-swallowed-type-errors.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  Casting with as or any without validation is silent unsafety
=======
  Using `as` casts or `any` to silence the type checker trades compile-time safety for runtime crashes — the types say one thing while the data says another. Runtime validation through schema parsers is the only way to maintain type guarantees across trust boundaries.
trigger_phrase:
  haiku: "no swallowed type errors validate casts"
  opus: "no swallowed type errors runtime validation"
  sonnet: "no swallowed type errors validate before casting"
>>>>>>> Stashed changes
---

# No Swallowed Type Errors

## What to flag
- TypeScript `as` casts used to bypass type-checker errors without runtime validation (e.g., `response as UserProfile`)
- Use of `any` type to silence compiler complaints instead of fixing the underlying type mismatch
- Python `typing.cast()` calls without corresponding runtime checks
- `@ts-ignore` or `@ts-expect-error` comments used to suppress type errors without an explanation of why the types are correct at runtime

## What to do
- Replace `as` casts with runtime validation: parse the data through a schema validator (Zod, io-ts, pydantic) that narrows the type safely
- Eliminate `any` by writing proper type definitions; use `unknown` when the type is genuinely not known and narrow with type guards
- If a `@ts-ignore` is truly necessary, add a comment explaining why the runtime behavior is safe and link to a tracking issue for a proper fix

## Exceptions
- Test files where `as` casts create intentional partial mocks (e.g., `{ id: 1 } as User`) for unit testing, provided the test itself validates the behavior
