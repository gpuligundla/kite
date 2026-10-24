#!/usr/bin/env bash
# Build the kite-studio image in Azure Container Registry (no local Docker) and deploy it as a
# Foundry hosted agent on the Invocations protocol. Prints the endpoint for STUDIO_AGENT_ENDPOINT.
#
# Required:  ACR_NAME                    registry name, without .azurecr.io
#            FOUNDRY_PROJECT_ENDPOINT    https://<account>.services.ai.azure.com/api/projects/<project>
#            ANTHROPIC_FOUNDRY_RESOURCE  the Foundry resource name that holds the Claude deployments
#            SONNET_DEPLOYMENT           the Claude Sonnet deployment name
# Optional:  HAIKU_DEPLOYMENT (defaults to SONNET_DEPLOYMENT), AGENT_NAME (kite-studio), IMAGE_TAG (git sha)
#
# The project must be in a hosted-agent region, and the caller needs Foundry Project Manager on it.
set -euo pipefail
cd "$(dirname "$0")/.."

for v in ACR_NAME FOUNDRY_PROJECT_ENDPOINT ANTHROPIC_FOUNDRY_RESOURCE SONNET_DEPLOYMENT; do
  [ -n "${!v:-}" ] || { echo "set $v (see the header of $0)" >&2; exit 2; }
done
AGENT_NAME=${AGENT_NAME:-kite-studio}
IMAGE_TAG=${IMAGE_TAG:-$(git rev-parse --short HEAD)}
HAIKU_DEPLOYMENT=${HAIKU_DEPLOYMENT:-$SONNET_DEPLOYMENT}

az account show >/dev/null 2>&1 || { echo "not logged in to Azure: run 'az login'" >&2; exit 2; }
LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv 2>/dev/null) \
  || { echo "cannot see registry '$ACR_NAME': run 'az account set --subscription <id>' or fix ACR_NAME" >&2; exit 2; }
IMAGE="$LOGIN_SERVER/$AGENT_NAME:$IMAGE_TAG"

echo "== building $IMAGE in ACR"
az acr build --registry "$ACR_NAME" --image "$AGENT_NAME:$IMAGE_TAG" --platform linux/amd64 studio-agent

TOKEN=$(az account get-access-token --resource https://ai.azure.com --query accessToken -o tsv)
API="api-version=v1"
AGENTS="$FOUNDRY_PROJECT_ENDPOINT/agents"
auth=(-H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json")
DEFINITION=$(cat <<JSON
{
  "kind": "hosted",
  "container_configuration": {"image": "$IMAGE"},
  "cpu": "2",
  "memory": "4Gi",
  "protocol_versions": [{"protocol": "invocations", "version": "2.0.0"}],
  "environment_variables": {
    "CLAUDE_CODE_USE_FOUNDRY": "1",
    "ANTHROPIC_FOUNDRY_RESOURCE": "$ANTHROPIC_FOUNDRY_RESOURCE",
    "ANTHROPIC_MODEL": "$SONNET_DEPLOYMENT",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "$SONNET_DEPLOYMENT",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "$HAIKU_DEPLOYMENT"
  }
}
JSON
)

echo "== creating agent version"
if curl -sf "${auth[@]}" "$AGENTS/$AGENT_NAME?$API" >/dev/null; then
  CREATED=$(curl -sf "${auth[@]}" -X POST "$AGENTS/$AGENT_NAME/versions?$API" -d "{\"definition\": $DEFINITION}")
else
  CREATED=$(curl -sf "${auth[@]}" -X POST "$AGENTS?$API" -d "{\"name\": \"$AGENT_NAME\", \"definition\": $DEFINITION}")
fi
echo "$CREATED"
VERSION=$(echo "$CREATED" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("version") or d.get("versions", [{}])[-1].get("version") or 1)')

echo "== waiting for version $VERSION to be active"
STATUS=creating
for _ in $(seq 1 60); do
  STATUS=$(curl -sf "${auth[@]}" "$AGENTS/$AGENT_NAME/versions/$VERSION?$API" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
  echo "  $STATUS"
  [ "$STATUS" = active ] && break
  [ "$STATUS" = failed ] && { curl -s "${auth[@]}" "$AGENTS/$AGENT_NAME/versions/$VERSION?$API"; exit 1; }
  sleep 5
done
[ "$STATUS" = active ] || { echo "gave up waiting for the version" >&2; exit 1; }

cat <<EOF
== deployed version $VERSION
STUDIO_AGENT_ENDPOINT=$AGENTS/$AGENT_NAME/endpoint/protocols/invocations

Before the first game works:
  1. The project's managed identity needs 'Container Registry Repository Reader' on $ACR_NAME (else image_pull_failed).
  2. The agent's own Entra identity needs 'Azure AI User' on the Foundry resource '$ANTHROPIC_FOUNDRY_RESOURCE'.
  3. Check the endpoint routes to version $VERSION:  curl -H "Authorization: Bearer \$TOKEN" "$AGENTS/$AGENT_NAME?$API"
  4. Put STUDIO_AGENT_ENDPOINT in brain/.env and restart the brain.
EOF
