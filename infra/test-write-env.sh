#!/usr/bin/env bash
# Runs infra/write-env.sh against a fake az in a throwaway repo and checks what it writes.
#   bash infra/test-write-env.sh
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

FAKE_KEY=fakekey0123456789secret
KEPT_MASTER=$(printf 'ab%.0s' {1..32})

mkdir -p "$tmp/infra" "$tmp/brain" "$tmp/bin"
cp "$repo/.gitignore" "$repo/.env.example" "$tmp/"
cp "$repo/infra/write-env.sh" "$tmp/infra/"
git -C "$tmp" init -q

cat > "$tmp/bin/az" <<EOF
#!/usr/bin/env bash
case "\$*" in
  "deployment group show"*) cat <<'JSON'
{
  "foundryAccountName": {"type": "String", "value": "kite-foundry-abc123"},
  "foundryEndpoint": {"type": "String", "value": "https://kite-foundry-abc123.services.ai.azure.com"},
  "contentSafetyEndpoint": {"type": "String", "value": "https://kite-foundry-abc123.cognitiveservices.azure.com/"},
  "answerDeployment": {"type": "String", "value": "claude-sonnet-5-5"},
  "fastDeployment": {"type": "String", "value": "claude-haiku-5-5"},
  "decisionDeployment": {"type": "String", "value": "decision-1"},
  "embedDeployment": {"type": "String", "value": "text-embedding-3-small"}
}
JSON
  ;;
  "cognitiveservices account keys list"*) echo "$FAKE_KEY" ;;
  *) echo "fake az: unexpected \$*" >&2; exit 1 ;;
esac
EOF
chmod +x "$tmp/bin/az"

run() { PATH="$tmp/bin:$PATH" bash "$tmp/infra/write-env.sh" >"$tmp/out" 2>&1; }
value() { grep "^$1=" "$tmp/brain/.env" | cut -d= -f2-; }
check() { if eval "$2"; then echo "ok: $1"; else echo "FAIL: $1"; cat "$tmp/out"; exit 1; fi; }

run
cat "$tmp/out"
check "fresh file has every Azure value" '
  [ "$(value FOUNDRY_ENDPOINT)" = https://kite-foundry-abc123.services.ai.azure.com ] &&
  [ "$(value FOUNDRY_KEY)" = "$FAKE_KEY" ] &&
  [ "$(value ANSWER_DEPLOYMENT)" = claude-sonnet-5-5 ] &&
  [ "$(value FAST_DEPLOYMENT)" = claude-haiku-5-5 ] &&
  [ "$(value DECISION_DEPLOYMENT)" = decision-1 ] &&
  [ "$(value EMBED_DEPLOYMENT)" = text-embedding-3-small ] &&
  [ "$(value CONTENT_SAFETY_ENDPOINT)" = https://kite-foundry-abc123.cognitiveservices.azure.com/ ] &&
  [ "$(value CONTENT_SAFETY_KEY)" = "$FAKE_KEY" ]'
check "fresh file keeps the .env.example template lines" \
  '[ "$(value KITE_DB_PATH)" = data/kite.db ] && grep -q "^KITE_VOICES={\"bands\"" "$tmp/brain/.env"'
check "fresh file gets a 64-hex KITE_MASTER_KEY" '[[ "$(value KITE_MASTER_KEY)" =~ ^[0-9a-f]{64}$ ]]'
check "file mode is 600" '[ "$(stat -c %a "$tmp/brain/.env")" = 600 ]'
check "output prints no secret" \
  '! grep -q -e "$FAKE_KEY" -e "$(value KITE_MASTER_KEY)" "$tmp/out"'

cat > "$tmp/brain/.env" <<EOF
FOUNDRY_KEY=stale
ELEVENLABS_API_KEY=el-keep
OPENROUTER_KEY=or-keep
KITE_VOICES={"bands":{"K-2":"v1"},"characters":{"narrator":"v2"}}
KITE_MASTER_KEY=$KEPT_MASTER
# a comment that stays
EOF
run
check "existing non-Azure values are kept" '
  [ "$(value ELEVENLABS_API_KEY)" = el-keep ] && [ "$(value OPENROUTER_KEY)" = or-keep ] &&
  [ "$(value KITE_VOICES)" = "{\"bands\":{\"K-2\":\"v1\"},\"characters\":{\"narrator\":\"v2\"}}" ] &&
  grep -q "^# a comment that stays$" "$tmp/brain/.env"'
check "an existing KITE_MASTER_KEY is never replaced" '[ "$(value KITE_MASTER_KEY)" = "$KEPT_MASTER" ]'
check "a stale Azure value is replaced, not duplicated" \
  '[ "$(grep -c "^FOUNDRY_KEY=" "$tmp/brain/.env")" = 1 ] && [ "$(value FOUNDRY_KEY)" = "$FAKE_KEY" ]'

cp "$tmp/brain/.env" "$tmp/before"
run
check "a rerun changes nothing" 'cmp -s "$tmp/before" "$tmp/brain/.env"'

rm "$tmp/.gitignore"
check "refuses to write when brain/.env is not gitignored" '! run && cmp -s "$tmp/before" "$tmp/brain/.env"'
