#!/usr/bin/env bash
# Creates or updates Kite's Azure resources. Safe to rerun. See docs/DEPLOY.md.
#
#   CLAUDE_ORG_NAME="Your Org" infra/deploy.sh
#   KITE_DEPLOY_APPS=true infra/deploy.sh      # after the images are pushed; scripts/deploy-azure.sh does both
set -euo pipefail
cd "$(dirname "$0")/.."

KITE_RG="${KITE_RG:-rg-kite}"
KITE_DEPLOYMENT="${KITE_DEPLOYMENT:-kite}"
# infra/main.bicepparam reads the exported variables.
export KITE_LOCATION="${KITE_LOCATION:-eastus2}"
export KITE_PREFIX="${KITE_PREFIX:-kite}"
export KITE_DEPLOY_APPS="${KITE_DEPLOY_APPS:-false}"

# az account show succeeds for a tenant-level sign-in with no subscription. Listing groups fails.
if ! az group list -o none 2>/dev/null; then
  echo "deploy: no usable subscription. Run az login, then az account set --subscription <id>." >&2
  exit 1
fi
if [ -z "${CLAUDE_ORG_NAME:-}" ]; then
  echo "deploy: set CLAUDE_ORG_NAME to the legal name of the organization using Claude." >&2
  echo "        Deploying accepts Anthropic's Marketplace terms in that name." >&2
  exit 1
fi
echo "subscription: $(az account show --query '[name, id]' -o tsv | paste -sd ' ')"
echo "group: $KITE_RG  region: $KITE_LOCATION  prefix: $KITE_PREFIX  apps: $KITE_DEPLOY_APPS"

# Empty when signed in as a service principal, which skips the developer role.
export KITE_DEVELOPER_ID="${KITE_DEVELOPER_ID:-$(az ad signed-in-user show --query id -o tsv 2>/dev/null || true)}"

# A rerun keeps the Claude capacity that is live now, so a limit raised by hand isn't cut back to 40.
account=$(az cognitiveservices account list -g "$KITE_RG" --query "[?kind=='AIServices'] | [0].name" -o tsv 2>/dev/null || true)
for model in sonnet haiku opus; do
  var="KITE_${model^^}_CAPACITY"
  live=""
  [ -n "$account" ] && live=$(az cognitiveservices account deployment show -g "$KITE_RG" -n "$account" \
    --deployment-name "claude-$model-5-5" --query sku.capacity -o tsv 2>/dev/null || true)
  export "$var=${!var:-${live:-40}}"
done
echo "claude capacity: sonnet $KITE_SONNET_CAPACITY  haiku $KITE_HAIKU_CAPACITY  opus $KITE_OPUS_CAPACITY"

if [ "$KITE_DEPLOY_APPS" = "true" ]; then
  # Read raw lines, because sourcing the file would strip the quotes inside the KITE_VOICES JSON.
  env_value() { grep -m1 "^$1=" brain/.env | cut -d= -f2- || true; }
  for name in ELEVENLABS_API_KEY KITE_MASTER_KEY OPENROUTER_KEY KITE_VOICES; do
    export "$name=$(env_value "$name")"
  done
  # scripts/deploy-azure.sh passes the endpoint of the agent it just deployed; otherwise brain/.env has it.
  export STUDIO_AGENT_ENDPOINT="${STUDIO_AGENT_ENDPOINT:-$(env_value STUDIO_AGENT_ENDPOINT)}"
  [ -n "$STUDIO_AGENT_ENDPOINT" ] || echo "deploy: no STUDIO_AGENT_ENDPOINT, so the brain app makes template movies and games only." >&2
  if [ -z "$KITE_MASTER_KEY" ] || [ -z "$ELEVENLABS_API_KEY" ]; then
    echo "deploy: the brain app needs KITE_MASTER_KEY and ELEVENLABS_API_KEY in brain/.env." >&2
    exit 1
  fi
fi

for ns in Microsoft.CognitiveServices Microsoft.ContainerRegistry Microsoft.OperationalInsights \
  Microsoft.Insights Microsoft.App Microsoft.ManagedIdentity Microsoft.SaaS Microsoft.MarketplaceOrdering; do
  az provider register --namespace "$ns" --wait --only-show-errors
done

az group create --name "$KITE_RG" --location "$KITE_LOCATION" --only-show-errors -o none
if [ "${KITE_WHAT_IF:-}" = 1 ]; then
  # A preview that changes nothing. Resource IDs only, so no setting or secret is printed.
  az deployment group what-if --resource-group "$KITE_RG" --name "$KITE_DEPLOYMENT" \
    --parameters infra/main.bicepparam --result-format ResourceIdOnly --only-show-errors
  exit 0
fi
az deployment group create \
  --resource-group "$KITE_RG" \
  --name "$KITE_DEPLOYMENT" \
  --parameters infra/main.bicepparam \
  --only-show-errors \
  --query 'properties.outputs.{foundry: foundryAccountName.value, project: projectEndpoint.value, registry: acrLoginServer.value, brain: brainUrl.value, web: webUrl.value}' \
  -o table

echo
echo "Next: run infra/write-env.sh to write the endpoints and keys into brain/.env."
