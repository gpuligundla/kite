#!/usr/bin/env bash
# Prints the /setup links that pair a browser with each seeded device. Run it in your own terminal;
# the links carry device tokens, so don't paste them into chats or commit them.
#   scripts/pair-links.sh [web base URL, default http://localhost:3000]
set -euo pipefail
cd "$(dirname "$0")/../brain"
BASE="${1:-http://localhost:3000}" uv run python - <<'PY'
import os
from kite_brain.config import get_settings
from kite_brain.crypto import master_key
from kite_brain.seed import device_token
base, key = os.environ["BASE"].rstrip("/"), master_key(get_settings().KITE_MASTER_KEY)
for kind, label in (("os", "Kid's screen"), ("handheld", "Phone (handheld mode)"), ("parent", "Grown-up view"), ("counselor", "Counselor inbox")):
    print(f"{label:24} {base}/setup?token={device_token(key, kind)}&to={kind}")
PY
