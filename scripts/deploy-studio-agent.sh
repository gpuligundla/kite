#!/usr/bin/env bash
# Build the kite-studio image in Azure Container Registry (no local Docker) and deploy it as a
# Foundry hosted agent on the Invocations protocol. Prints the endpoint for STUDIO_AGENT_ENDPOINT.
#
# Required:  ACR_NAME                    registry name, without .azurecr.io
#            FOUNDRY_PROJECT_ENDPOINT    https://<account>.services.ai.azure.com/api/projects/<project>
#            ANTHROPIC_FOUNDRY_RESOURCE  the Foundry resource name that holds the Claude deployments
#            OPUS_DEPLOYMENT             the Claude Opus deployment name (claude-opus-5-5): Claude Code builds with it
# Optional:  HAIKU_DEPLOYMENT (defaults to OPUS_DEPLOYMENT; Claude Code's small internal calls), AGENT_NAME (kite-studio), IMAGE_TAG (git sha),
#            SKIP_BUILD=1 to reuse an image already in the registry under IMAGE_TAG
#
# The project must be in a hosted-agent region, and the caller needs Foundry Project Manager on it.
set -euo pipefail
cd "$(dirname "$0")/.."

for v in ACR_NAME FOUNDRY_PROJECT_ENDPOINT ANTHROPIC_FOUNDRY_RESOURCE OPUS_DEPLOYMENT; do
  [ -n "${!v:-}" ] || { echo "set $v (see the header of $0)" >&2; exit 2; }
done
AGENT_NAME=${AGENT_NAME:-kite-studio}
IMAGE_TAG=${IMAGE_TAG:-$(git rev-parse --short HEAD)}
HAIKU_DEPLOYMENT=${HAIKU_DEPLOYMENT:-$OPUS_DEPLOYMENT}

az account show >/dev/null 2>&1 || { echo "not logged in to Azure: run 'az login'" >&2; exit 2; }
LOGIN_SERVER=$(az acr show --name "$ACR_NAME" --query loginServer -o tsv 2>/dev/null) \
  || { echo "cannot see registry '$ACR_NAME': run 'az account set --subscription <id>' or fix ACR_NAME" >&2; exit 2; }
IMAGE="$LOGIN_SERVER/$AGENT_NAME:$IMAGE_TAG"

if [ "${SKIP_BUILD:-}" = 1 ]; then
  echo "== reusing $IMAGE"
else
  echo "== building $IMAGE in ACR"
  az acr build --registry "$ACR_NAME" --image "$AGENT_NAME:$IMAGE_TAG" --platform linux/amd64 studio-agent
fi

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
    "ANTHROPIC_MODEL": "$OPUS_DEPLOYMENT",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "$OPUS_DEPLOYMENT",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL": "$HAIKU_DEPLOYMENT"
  }
}
JSON
)

echo "== creating agent version"
if curl -sf "${auth[@]}" "$AGENTS/$AGENT_NAME?$API" >/dev/null 2>&1; then
  CREATED=$(curl -sSf "${auth[@]}" -X POST "$AGENTS/$AGENT_NAME/versions?$API" -d "{\"definition\": $DEFINITION}")
else
  CREATED=$(curl -sSf "${auth[@]}" -X POST "$AGENTS?$API" -d "{\"name\": \"$AGENT_NAME\", \"definition\": $DEFINITION}")
fi
echo "$CREATED"
# The create-agent response nests the new version under versions.latest; the create-version response is flat.
read -r VERSION PRINCIPAL < <(echo "$CREATED" | python3 -c '
import json, sys
d = json.load(sys.stdin)
v = (d.get("versions") or {}).get("latest") or d
print(v.get("version") or 1, (v.get("instance_identity") or d.get("instance_identity") or {}).get("principal_id", "-"))')

echo "== waiting for version $VERSION to be active"
STATUS=creating
for _ in $(seq 1 60); do
  STATUS=$(curl -sSf "${auth[@]}" "$AGENTS/$AGENT_NAME/versions/$VERSION?$API" | python3 -c 'import json,sys; print(json.load(sys.stdin)["status"])')
  echo "  $STATUS"
  [ "$STATUS" = active ] && break
  [ "$STATUS" = failed ] && { curl -s "${auth[@]}" "$AGENTS/$AGENT_NAME/versions/$VERSION?$API"; exit 1; }
  sleep 5
done
[ "$STATUS" = active ] || { echo "gave up waiting for the version" >&2; exit 1; }

# A new agent's endpoint starts out serving the Responses protocol only; route it to invocations on this version.
echo "== routing the endpoint to invocations on version $VERSION"
ROUTE='{"agent_endpoint": {"protocols": ["invocations"], "protocol_configuration": {"invocations": {}},
  "version_selector": {"version_selection_rules": [{"type": "FixedRatio", "agent_version": "'"$VERSION"'", "traffic_percentage": 100}]}}}'
curl -sSf -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/merge-patch+json" -X PATCH "$AGENTS/$AGENT_NAME?$API" -d "$ROUTE" >/dev/null \
  || curl -sSf "${auth[@]}" -X PATCH "$AGENTS/$AGENT_NAME?$API" -d "$ROUTE" >/dev/null \
  || echo "  could not patch the endpoint; set protocols to invocations in the Foundry portal" >&2
curl -sSf "${auth[@]}" "$AGENTS/$AGENT_NAME?$API" | python3 -c '
import json, sys
e = json.load(sys.stdin).get("agent_endpoint", {})
rules = e.get("version_selector", {}).get("version_selection_rules", [])
print("  endpoint protocols:", e.get("protocols"), "versions:", [r.get("agent_version") for r in rules])'

if [ "$PRINCIPAL" != - ]; then
  echo "== granting the agent identity $PRINCIPAL Azure AI User on $ANTHROPIC_FOUNDRY_RESOURCE"
  ACCOUNT_ID=$(az cognitiveservices account list --query "[?name=='$ANTHROPIC_FOUNDRY_RESOURCE'].id | [0]" -o tsv)
  az role assignment create --assignee-object-id "$PRINCIPAL" --assignee-principal-type ServicePrincipal \
    --role 53ca6127-db72-4b80-b1b0-d745d6d5456d --scope "$ACCOUNT_ID" -o none \
    || echo "  role assignment failed; grant Azure AI User to $PRINCIPAL on $ANTHROPIC_FOUNDRY_RESOURCE by hand" >&2
fi

cat <<EOF
== deployed version $VERSION
STUDIO_AGENT_ENDPOINT=$AGENTS/$AGENT_NAME/endpoint/protocols/invocations

Before the first game works:
  1. The project's managed identity needs 'Container Registry Repository Reader' on $ACR_NAME (else image_pull_failed).
  2. The endpoint protocols line above must include invocations.
  3. Put STUDIO_AGENT_ENDPOINT in brain/.env and restart the brain.
EOF
