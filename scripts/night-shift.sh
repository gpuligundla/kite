#!/usr/bin/env bash
# The night shift (spec section 13): a fresh database, Maya's simulated childhood, the
# demo-shape check and the snapshot the demo restores. Safe to rerun after a crash.
#
#   scripts/night-shift.sh                 # grades 1-11, 30 turns each
#   TURNS_PER_GRADE=15 scripts/night-shift.sh   # the morning fallback
set -euo pipefail
cd "$(dirname "$0")/../brain"

TURNS="${TURNS_PER_GRADE:-30}"

missing=$(uv run python -c '
from kite_brain.config import get_settings
s = get_settings()
print(" ".join(k for k in ("FOUNDRY_KEY", "KITE_MASTER_KEY") if not getattr(s, k)))
')
if [ -n "$missing" ]; then
  echo "night shift: $missing not set. Put them in brain/.env (or export them) and rerun." >&2
  exit 1
fi

DB=data/kite.db
SNAPSHOT=data/demo-snapshot.db
rm -f "$DB" "$DB-wal" "$DB-shm"

uv run python -m kite_brain.seed --assets
uv run python -m evals.simulate --grades 1-11 --turns "$TURNS"
# 10 persisted turns per simulated turn-per-grade: 300 at the default 30, 150 at 15.
uv run python -m evals.shape --min-turns "$((TURNS * 10))"
uv run python -c "import sys; from evals import backup; backup(sys.argv[1], sys.argv[2])" "$DB" "$SNAPSHOT"
echo "snapshot: brain/$SNAPSHOT"

# Red team, pedagogy and write gate run on a throwaway copy and publish docs/trust/*.json.
uv run python -m evals.redteam --snapshot "$SNAPSHOT"
echo "night shift done. Review docs/trust/scorecard.json and docs/trust/readability.json, then commit them."
