#!/usr/bin/env bash
# Prints the /setup links that pair a browser with each seeded device. Run it in your own terminal;
# the links carry device tokens, so don't paste them into chats or commit them.
#   scripts/pair-links.sh                 # local: four devices on one laptop, no extra Chrome profiles
#   scripts/pair-links.sh https://<host>  # deployed: one host, so use a separate Chrome profile per device
#
# Each device is one kite_token cookie, and a browser keeps cookies per host name and per incognito session.
# Locally, localhost and 127.0.0.1 are two hosts (both secure contexts, so the mic works) and normal vs
# incognito doubles that: four independent devices side by side.
set -euo pipefail
cd "$(dirname "$0")/../brain"
BASE="${1:-}" uv run python - <<'PY'
import os
from kite_brain.config import get_settings
from kite_brain.crypto import master_key
from kite_brain.seed import device_token
key, base = master_key(get_settings().KITE_MASTER_KEY), os.environ["BASE"].rstrip("/")
local = {  # device: (label, host, where to open it)
    "os": ("Kid's screen (Chromebook)", "http://localhost:3000", "normal window"),
    "handheld": ("Phone (handheld mode)", "http://127.0.0.1:3000", "normal window, DevTools device mode (Ctrl+Shift+M)"),
    "parent": ("Grown-up view", "http://localhost:3000", "incognito window"),
    "counselor": ("Counselor inbox", "http://127.0.0.1:3000", "incognito window"),
}
for kind, (label, host, where) in local.items():
    url = f"{base or host}/setup?token={device_token(key, kind)}&to={kind}"
    print(f"{label}\n  open in: {'a separate Chrome profile' if base else where}\n  {url}\n")
PY
