#!/usr/bin/env bash
# Put the night shift's snapshot back as the live database. Run before every rehearsal and the demo.
set -euo pipefail
cd "$(dirname "$0")/../brain"

DB=data/kite.db
SNAPSHOT=data/demo-snapshot.db
[ -f "$SNAPSHOT" ] || { echo "restore: no snapshot at brain/$SNAPSHOT. Run scripts/night-shift.sh first." >&2; exit 1; }

rm -f "$DB-wal" "$DB-shm"
cp "$SNAPSHOT" "$DB"
echo "restored brain/$DB from the snapshot. Restart the brain now: it holds the old database open."
