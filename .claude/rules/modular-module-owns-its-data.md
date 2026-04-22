---
slug: modular-module-owns-its-data
type: rule
version: 1.0.0
scope: agent
severity: block
tags:
  - modular-architecture
  - data-ownership
  - boundaries
manifest:
  install_path: .claude/rules/modular-module-owns-its-data.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  Modules manage their own data layer; no module reaches into another's database tables
=======
  When modules directly access each other's tables, schema changes in one module silently break others, and data integrity constraints become impossible to enforce locally. Exclusive data ownership ensures modules can evolve their storage independently and enables future extraction into separate services.
trigger_phrase:
  haiku: "module owns data no cross-module table queries"
  opus: "module owns its data no cross-module table access"
  sonnet: "module owns its data no cross-module table access"
>>>>>>> Stashed changes
---

# Each Module Owns Its Own Data

## What to flag
- SQL queries or ORM calls in one module that directly read from or write to tables owned by another module (e.g., billing module running `SELECT * FROM users` instead of calling the users module API)
- Migrations or schema definitions for tables belonging to another module placed in the wrong module's migration directory
- Direct foreign key joins across module boundaries in application code (e.g., joining `orders` and `inventory` tables in a single query from the orders module)
- Shared database models or repository classes used by multiple modules to access the same tables

## What to do
- Each module defines and manages its own tables, migrations, and data access code exclusively
- When a module needs data from another module, it calls that module's public API or uses an event-driven approach to maintain a local read copy
- If cross-module queries are needed for reporting, create a dedicated read model or reporting module that subscribes to events from both modules

## Exceptions
- Shared reference data tables (e.g., country codes, currency codes) that are truly static and owned by a common reference module
- Database views or materialized views created specifically for cross-module reporting in a dedicated analytics layer
