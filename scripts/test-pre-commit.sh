#!/usr/bin/env bash
set -euo pipefail

hook="$(cd "$(dirname "$0")" && pwd)/pre-commit"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
git init -q

expect() { # expect <pass|fail> <description>
  if "$hook" 2>/dev/null; then got=pass; else got=fail; fi
  [ "$got" = "$1" ] || { echo "FAIL: $2 (expected $1)"; exit 1; }
  git reset -q
  git clean -fdq
}

echo hello > readme.txt
git add -A
expect pass "ordinary file"

echo "X=1" > .env
git add -A
expect fail ".env at root"

mkdir sub
echo "X=1" > sub/.env
git add -A
expect fail ".env in subdirectory"

echo "# example" > .env.example
git add -A
expect pass ".env.example"

echo "token = sk-ant-""abcdefghij1234" > notes.txt
git add -A
expect fail "Anthropic key"

echo "FOUNDRY_KEY=$(printf 'a1%.0s' {1..16})" > conf.txt
git add -A
expect fail "32-char hex on a KEY line"

echo "checksum=$(printf 'a1%.0s' {1..16})" > conf.txt
git add -A
expect pass "32-char hex without KEY"

echo ok
