#!/usr/bin/env bash
# Writes the Azure endpoints, deployment names and keys from the last infra/deploy.sh run into
# brain/.env. Every other line in brain/.env stays as it is. Prints key names, never values.
# Safe to rerun.
set -euo pipefail
cd "$(dirname "$0")/.."

RG="${KITE_RG:-rg-kite}"
DEPLOYMENT="${KITE_DEPLOYMENT:-kite}"
ENV_FILE=brain/.env

if ! git check-ignore -q "$ENV_FILE"; then
  echo "write-env: $ENV_FILE is not gitignored, so it could be committed. Add .env to .gitignore first." >&2
  exit 1
fi

outputs=$(az deployment group show -g "$RG" -n "$DEPLOYMENT" --query properties.outputs -o json --only-show-errors)
account=$(python3 -c 'import json, sys; print(json.load(sys.stdin)["foundryAccountName"]["value"])' <<<"$outputs")
key=$(az cognitiveservices account keys list -g "$RG" -n "$account" --query key1 -o tsv --only-show-errors)

# The key reaches Python through the environment, not argv, so ps never shows it.
KITE_OUTPUTS="$outputs" KITE_KEY="$key" python3 - "$ENV_FILE" <<'PY'
import json
import os
import secrets
import sys
import tempfile

path = sys.argv[1]
out = {name: o["value"] for name, o in json.loads(os.environ["KITE_OUTPUTS"]).items()}
key = os.environ["KITE_KEY"]
azure = {
    "FOUNDRY_ENDPOINT": out["foundryEndpoint"],
    "FOUNDRY_KEY": key,
    "ANSWER_DEPLOYMENT": out["answerDeployment"],
    "FAST_DEPLOYMENT": out["fastDeployment"],
    "DECISION_DEPLOYMENT": out["decisionDeployment"],
    "EMBED_DEPLOYMENT": out["embedDeployment"],
    "CONTENT_SAFETY_ENDPOINT": out["contentSafetyEndpoint"],
    "CONTENT_SAFETY_KEY": key,
}

source = path if os.path.exists(path) else ".env.example"
lines = open(source).read().splitlines()
current = dict(line.split("=", 1) for line in lines if "=" in line and not line.startswith("#"))

generated = []
if not current.get("KITE_MASTER_KEY"):
    azure["KITE_MASTER_KEY"] = secrets.token_hex(32)
    generated.append("KITE_MASTER_KEY")

written = set()
merged = []
for line in lines:
    name = line.split("=", 1)[0]
    if "=" in line and name in azure:
        merged.append(f"{name}={azure[name]}")
        written.add(name)
    else:
        merged.append(line)
merged += [f"{name}={value}" for name, value in azure.items() if name not in written]

# mkstemp creates the file with mode 600. The rename replaces brain/.env in one step.
fd, tmp = tempfile.mkstemp(dir=os.path.dirname(path), prefix=".env.")
with os.fdopen(fd, "w") as f:
    f.write("\n".join(merged) + "\n")
os.replace(tmp, path)
os.chmod(path, 0o600)

print(f"{path}: set {', '.join(n for n in azure if n not in generated)}")
if generated:
    print(f"{path}: generated {', '.join(generated)}")
voices = json.loads(current.get("KITE_VOICES") or "{}")
empty = [n for n in ("ELEVENLABS_API_KEY",) if not current.get(n)]
empty += [f"KITE_VOICES.{group}.{name}" for group, ids in voices.items() for name, v in ids.items() if not v]
if empty or not voices:
    print(f"{path}: still to fill in by hand: {', '.join(empty) or 'KITE_VOICES'}")
PY
