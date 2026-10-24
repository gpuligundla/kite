// Values come from environment variables so infra/deploy.sh can set them. See docs/DEPLOY.md.
using 'main.bicep'

param location = readEnvironmentVariable('KITE_LOCATION', 'eastus2')
param namePrefix = readEnvironmentVariable('KITE_PREFIX', 'kite')
param developerPrincipalId = readEnvironmentVariable('KITE_DEVELOPER_ID', '')
param claudeOrganizationName = readEnvironmentVariable('CLAUDE_ORG_NAME')
param claudeCountryCode = readEnvironmentVariable('CLAUDE_COUNTRY_CODE', 'US')
param claudeIndustry = readEnvironmentVariable('CLAUDE_INDUSTRY', 'education')
param deployApps = bool(readEnvironmentVariable('KITE_DEPLOY_APPS', 'false'))
param kiteVoices = readEnvironmentVariable('KITE_VOICES', '{}')
param appSecrets = {
  ELEVENLABS_API_KEY: readEnvironmentVariable('ELEVENLABS_API_KEY', '')
  KITE_MASTER_KEY: readEnvironmentVariable('KITE_MASTER_KEY', '')
  OPENROUTER_KEY: readEnvironmentVariable('OPENROUTER_KEY', '')
}
