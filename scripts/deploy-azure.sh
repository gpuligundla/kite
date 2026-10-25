#!/usr/bin/env bash
# Moves Kite onto Azure in one command, and is safe to rerun:
#   1. the Foundry account, models, registry and monitoring (infra/deploy.sh)
#   2. the kite-studio hosted agent, Claude Code on Opus 5.5 (scripts/deploy-studio-agent.sh)
#   3. the brain and web images, built in the registry and tagged with the commit
#   4. the kite-brain and kite-web Container Apps, rolled to those images
#   5. a health check, and how to pair each device
#
#   scripts/deploy-azure.sh                 # everything
#   SKIP_STUDIO=1 scripts/deploy-azure.sh   # keep the studio agent that's running
#
# Needs az login on the subscription, brain/.env from infra/write-env.sh (keys, KITE_MASTER_KEY, KITE_VOICES), and
# brain/data/demo-snapshot.db, which the brain image carries as its live database. No local Docker: images build in
# the registry. The brain keeps SQLite on the container's disk, so restarting its revision restores the snapshot.
set -euo pipefail
cd "$(dirname "$0")/.."

export KITE_RG="${KITE_RG:-rg-kite}"
export KITE_DEPLOYMENT="${KITE_DEPLOYMENT:-kite}"
TAG="${IMAGE_TAG:-$(git rev-parse --short HEAD)}"
output() { az deployment group show -g "$KITE_RG" -n "$KITE_DEPLOYMENT" --query "properties.outputs.$1.value" -o tsv; }

[ -f brain/.env ] || { echo "deploy-azure: no brain/.env. Run infra/deploy.sh and infra/write-env.sh first." >&2; exit 1; }
[ -f brain/data/demo-snapshot.db ] || { echo "deploy-azure: no brain/data/demo-snapshot.db for the brain image." >&2; exit 1; }
if [ -n "$(git status --porcelain -- apps brain packages studio-agent)" ]; then
  echo "deploy-azure: uncommitted changes go into the images too, under tag $TAG." >&2
fi
# The organization that accepted Anthropic's terms, from the last deployment, unless it's set.
export CLAUDE_ORG_NAME="${CLAUDE_ORG_NAME:-$(az deployment group show -g "$KITE_RG" -n "$KITE_DEPLOYMENT" \
  --query properties.parameters.claudeOrganizationName.value -o tsv 2>/dev/null || true)}"

echo "== 1. Foundry, models and registry"
infra/deploy.sh
ACR=$(output acrName)
LOGIN=$(output acrLoginServer)
PROJECT=$(output projectEndpoint)
ACCOUNT=$(output foundryAccountName)

echo "== 2. The studio agent"
if [ "${SKIP_STUDIO:-}" = 1 ]; then
  echo "kept the running agent"
else
  ACR_NAME=$ACR FOUNDRY_PROJECT_ENDPOINT=$PROJECT ANTHROPIC_FOUNDRY_RESOURCE=$ACCOUNT IMAGE_TAG=$TAG \
    OPUS_DEPLOYMENT=$(output directorDeployment) HAIKU_DEPLOYMENT=$(output fastDeployment) scripts/deploy-studio-agent.sh
fi
export STUDIO_AGENT_ENDPOINT="$PROJECT/agents/${AGENT_NAME:-kite-studio}/endpoint/protocols/invocations"

echo "== 3. Images $TAG"
# Fold the snapshot's write-ahead log in, so the image's copy holds every row.
(cd brain && uv run python -c "import sqlite3; sqlite3.connect('data/demo-snapshot.db').execute('PRAGMA wal_checkpoint(TRUNCATE)')")
az acr build --registry "$ACR" --image "kite-brain:$TAG" --image kite-brain:latest --platform linux/amd64 -f brain/Dockerfile .
az acr build --registry "$ACR" --image "kite-web:$TAG" --image kite-web:latest --platform linux/amd64 -f apps/web/Dockerfile .

echo "== 4. Container Apps"
KITE_DEPLOY_APPS=true KITE_BRAIN_IMAGE="$LOGIN/kite-brain:$TAG" KITE_WEB_IMAGE="$LOGIN/kite-web:$TAG" infra/deploy.sh
BRAIN=$(output brainUrl)
WEB=$(output webUrl)

echo "== 5. Health"
for i in $(seq 1 36); do
  curl -fsS "$BRAIN/health" >/dev/null 2>&1 && curl -fsS -o /dev/null "$WEB/os" 2>/dev/null && break
  [ "$i" = 36 ] && { echo "deploy-azure: not healthy after 6 minutes. Check: az containerapp logs show -g $KITE_RG -n kite-brain" >&2; exit 1; }
  sleep 10
done
cat <<EOF
Kite is live.
  web:   $WEB
  brain: $BRAIN
Pair each device in your own terminal (the links carry tokens, so don't paste them anywhere):
  scripts/pair-links.sh $WEB
On a phone, open the handheld link in Chrome, then Add to Home screen to install Kite full screen.
To put the demo data back before a rehearsal, restart the brain's revision:
  az containerapp revision restart -g $KITE_RG -n kite-brain --revision \$(az containerapp show -g $KITE_RG -n kite-brain --query properties.latestRevisionName -o tsv)
EOF
