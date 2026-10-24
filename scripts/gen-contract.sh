#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
schema=$(mktemp --suffix=.json)
trap 'rm -f "$schema"' EXIT

(cd "$root/brain" && uv run python -m kite_brain.export_openapi) > "$schema"
mkdir -p "$root/packages/client/src"
npx --no-install openapi-typescript "$schema" -o "$root/packages/client/src/contract.d.ts"
