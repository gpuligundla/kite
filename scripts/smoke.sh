#!/usr/bin/env bash
# Smoke test: health, one text turn, and the parent stream must carry answer.done within 20 s.
# Usage: scripts/smoke.sh <base_url> <os_token> <parent_token>
set -euo pipefail

base="${1:?usage: smoke.sh <base_url> <os_token> <parent_token>}"
os_token="${2:?missing os token}"
parent_token="${3:?missing parent token}"
base="${base%/}"
kid=maya

curl -fsS "$base/health" | grep -q '"ok":true' || { echo "FAIL: /health" >&2; exit 1; }

# Listen before the turn starts, so no event is missed.
events="$(mktemp)"
trap 'kill "${listener:-}" 2>/dev/null || true; rm -f "$events"' EXIT
curl -sN --max-time 20 -H "Authorization: Bearer $parent_token" "$base/kids/$kid/events" >"$events" &
listener=$!
sleep 1

curl -fsS -X POST "$base/turns" -H "Authorization: Bearer $os_token" \
    -F "kid_id=$kid" -F device=os -F mode=talk -F "text=why is the sky blue?" >/dev/null \
    || { echo "FAIL: POST /turns" >&2; exit 1; }

for _ in $(seq 20); do
    if grep -q '^event: answer.done' "$events"; then
        echo ok
        exit 0
    fi
    sleep 1
done
echo "FAIL: no answer.done on the parent stream within 20 s" >&2
exit 1
