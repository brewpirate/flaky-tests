---
slug: validate-inputs-at-boundaries
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - resilience
  - validation
  - security
manifest:
  install_path: .claude/rules/validate-inputs-at-boundaries.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  External data validated before use at every trust boundary
=======
  Data crossing a trust boundary (HTTP requests, file reads, env vars, third-party APIs) has no type guarantees — using it without validation turns every boundary into a potential injection point or runtime crash site. Schema validation at ingress ensures business logic only ever sees well-typed, safe data.
trigger_phrase:
  haiku: "validate inputs trust boundary"
  opus: "validate inputs at trust boundaries"
  sonnet: "validate inputs at trust boundaries"
>>>>>>> Stashed changes
---

# Validate Inputs at Boundaries

## What to flag
- HTTP request bodies, query parameters, or headers used directly without schema validation
- Environment variables read and used without type checking or presence verification
- File contents parsed (JSON, YAML, CSV) and passed into business logic without structural validation
- Data from third-party APIs or message queues consumed without verifying expected shape and types

## What to do
- Apply schema validation (Zod, Joi, JSON Schema, pydantic) at every ingress point before data enters business logic
- Fail fast with a descriptive error message that identifies which field failed and why
- Treat all data crossing a trust boundary as untrusted: user input, API responses, file reads, database results from shared tables

## Exceptions
- Internal function calls within a validated trust boundary do not need redundant re-validation if the data has already been validated at the boundary entry point
