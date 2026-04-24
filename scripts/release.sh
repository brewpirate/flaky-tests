#!/usr/bin/env bash
# Release pipeline: copy LICENSE into each publishable package, build, publish via changesets.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$REPO_ROOT"

echo "==> Copying LICENSE into publishable packages"
bun run scripts/copy-license.ts

echo "==> Building all packages"
bun run build:types
bun run build

echo "==> Publishing via changesets"
bun changeset publish
