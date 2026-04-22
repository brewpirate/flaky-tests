---
slug: no-eval-or-dynamic-execution
type: rule
version: 1.0.0
scope: global
severity: block
tags:
  - security
  - injection
manifest:
  install_path: .claude/rules/no-eval-or-dynamic-execution.md
  compatible_stacks:
    - all
  depends_on: []
  conflicts_with: []
description: >
<<<<<<< Updated upstream
  eval(), Function(), exec() are injection vectors regardless of input source
=======
  Dynamic code execution functions like eval(), new Function(), and shell exec() with interpolated strings are the most direct path to remote code execution vulnerabilities. Even when current inputs seem safe, future callers or upstream changes can introduce untrusted data.
trigger_phrase:
  haiku: "eval dynamic injection security"
  opus: "eval dynamic execution injection security"
  sonnet: "eval dynamic code execution injection"
>>>>>>> Stashed changes
---

# No eval() or Dynamic Code Execution

## What to flag
- Calls to `eval()`, `new Function()`, `setTimeout`/`setInterval` with string arguments in JavaScript/TypeScript
- Use of `exec()`, `compile()`, or `__import__()` with dynamic strings in Python
- Shell execution via `child_process.exec()`, `os.system()`, or `subprocess.run(shell=True)` with interpolated user input
- Template engines configured to allow arbitrary code execution (e.g., Jinja2 with `SandboxedEnvironment` disabled)

## What to do
- Replace `eval()` and `new Function()` with structured alternatives: `JSON.parse()` for data, lookup tables or strategy patterns for dynamic dispatch
- Use parameterized APIs instead of string interpolation for shell commands (`execFile` instead of `exec`, `subprocess.run([...])` instead of `shell=True`)
- If dynamic behavior is genuinely required, sandbox it with a restricted runtime (e.g., `vm2`, WebAssembly, or a container-isolated interpreter)

## Exceptions
- Build tooling (bundlers, transpilers) that generates code at compile time, not at runtime
- REPL or developer-console features explicitly gated behind admin authentication and never exposed to end users
