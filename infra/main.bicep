// Kite's Azure resources: one Foundry account with Claude, Decision-1 and embeddings, a project for
// the hosted studio agent, a container registry, monitoring, and (from Sunday) the brain and web apps.
// Deploy with infra/deploy.sh. Never output keys. infra/write-env.sh reads them with az.

@description('Region. Each one listed had Claude 5.5 (version 1, GlobalStandard), Microsoft-Decision-1 (DataZoneStandard), text-embedding-3-small, Content Safety and hosted agents on 2026-10-24.')
@allowed([
  'eastus2'
  'eastus'
  'centralus'
  'northcentralus'
  'southcentralus'
  'westus'
  'westus3'
  'swedencentral'
])
param location string = 'eastus2'

@description('Lowercase letters and digits. Prefixes every resource name.')
@minLength(2)
@maxLength(10)
param namePrefix string = 'kite'

@description('Object ID that gets Azure AI User on the Foundry account, so az login works with Entra auth. Empty skips it.')
param developerPrincipalId string = ''

@allowed([
  'User'
  'ServicePrincipal'
])
param developerPrincipalType string = 'User'

@description('Legal name of the organization using Claude. Sent to Anthropic, and accepts the Marketplace terms on your behalf.')
@minLength(1)
param claudeOrganizationName string

@minLength(2)
@maxLength(2)
param claudeCountryCode string = 'US'

@allowed([
  'technology'
  'finance'
  'healthcare'
  'education'
  'retail'
  'manufacturing'
  'government'
  'media'
  'other'
])
param claudeIndustry string = 'education'

@description('Claude model version: 1 is hosted on Anthropic infrastructure, 2 is hosted on Azure. For the 5.5 models, version 2 is Data Zone Standard only.')
param claudeVersion string = '1'

@allowed([
  'GlobalStandard'
  'DataZoneStandard'
])
param claudeSku string = 'GlobalStandard'

// Claude and embeddings capacity is thousands of tokens per minute. Pay-as-you-go subscriptions get 40K
// input TPM per Claude model. The catalog gives Decision-1 a default capacity of 500 and limits of 1 request
// and 1,000 tokens per minute, which read as per unit, so a capacity of 1 would allow one request a minute.
param sonnetCapacity int = 40
param haikuCapacity int = 40
param decisionCapacity int = 500
param embedCapacity int = 50

@description('Create the Container Apps environment and the kite-brain and kite-web apps. Needs the images in the registry first.')
param deployApps bool = false

@description('Defaults to <registry>/kite-brain:latest.')
param brainImage string = ''

@description('Defaults to <registry>/kite-web:latest.')
param webImage string = ''

@description('JSON for KITE_VOICES. Read by the brain app only.')
param kiteVoices string = '{}'

@description('ELEVENLABS_API_KEY, KITE_MASTER_KEY and OPENROUTER_KEY for the brain app. Empty values are skipped.')
@secure()
param appSecrets object = {}

var suffix = take(uniqueString(resourceGroup().id), 6)
var foundryName = '${namePrefix}-foundry-${suffix}'
var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var azureAiUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'

var claudeProvider = {
  organizationName: claudeOrganizationName
  countryCode: claudeCountryCode
  industry: claudeIndustry
}

// Deployment names equal model IDs, so Claude Code recognizes each model by its deployment name.
// Decision-1 is the exception: Azure rejects resource names containing "Microsoft" with ContainsReservedWord.
// On 2026-10-24 the catalog offered Decision-1 only as DataZoneStandard. GlobalStandard fails preflight
// with SpecialFeatureOrQuotaIdRequired.
var models = {
  answer: { name: 'claude-sonnet-5-5', format: 'Anthropic', version: claudeVersion, sku: claudeSku, capacity: sonnetCapacity }
  fast: { name: 'claude-haiku-5-5', format: 'Anthropic', version: claudeVersion, sku: claudeSku, capacity: haikuCapacity }
  decision: { name: 'decision-1', model: 'Microsoft-Decision-1', format: 'Microsoft', version: '1', sku: 'DataZoneStandard', capacity: decisionCapacity }
  embed: { name: 'text-embedding-3-small', format: 'OpenAI', version: '1', sku: 'GlobalStandard', capacity: embedCapacity }
}

resource logs 'Microsoft.OperationalInsights/workspaces@2025-02-01' = {
  name: '${namePrefix}-logs-${suffix}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${namePrefix}-appi-${suffix}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logs.id
  }
}

resource foundry 'Microsoft.CognitiveServices/accounts@2025-10-01-preview' = {
  name: foundryName
  location: location
  kind: 'AIServices'
  sku: { name: 'S0' }
  identity: { type: 'SystemAssigned' }
  properties: {
    customSubDomainName: foundryName
    allowProjectManagement: true
    publicNetworkAccess: 'Enabled'
    // The brain authenticates with the account key.
    disableLocalAuth: false
  }
}

// Foundry rejects concurrent deployment writes on one account, so these go one at a time.
// modelProviderData isn't in the Bicep types yet. Adding it through union() keeps the build free of BCP037.
@batchSize(1)
resource deployments 'Microsoft.CognitiveServices/accounts/deployments@2025-10-01-preview' = [
  for m in items(models): {
    parent: foundry
    name: m.value.name
    sku: {
      name: m.value.sku
      capacity: m.value.capacity
    }
    properties: union(
      {
        model: {
          format: m.value.format
          name: m.value.?model ?? m.value.name
          version: m.value.version
        }
      },
      m.value.format == 'Anthropic' ? { modelProviderData: claudeProvider } : {}
    )
  }
]

// Created before the project: project creation also grants its creator Azure AI User, and a second
// assignment of the same role under a different name fails with RoleAssignmentExists.
resource developerAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = if (!empty(developerPrincipalId)) {
  scope: foundry
  name: guid(foundry.id, developerPrincipalId, azureAiUserRoleId)
  properties: {
    principalId: developerPrincipalId
    principalType: developerPrincipalType
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', azureAiUserRoleId)
  }
}

resource project 'Microsoft.CognitiveServices/accounts/projects@2025-10-01-preview' = {
  parent: foundry
  name: '${namePrefix}-project'
  location: location
  identity: { type: 'SystemAssigned' }
  properties: {}
  dependsOn: [
    deployments
    developerAiUser
  ]
}

// Hosted agents send their traces to this connection.
resource appInsightsConnection 'Microsoft.CognitiveServices/accounts/projects/connections@2025-10-01-preview' = {
  parent: project
  name: 'appinsights'
  properties: {
    category: 'AppInsights'
    target: appInsights.id
    authType: 'ApiKey'
    isSharedToAll: true
    credentials: {
      key: appInsights.properties.ConnectionString
    }
    metadata: {
      ApiType: 'Azure'
      ResourceId: appInsights.id
    }
  }
}

resource acr 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: '${namePrefix}acr${suffix}'
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
    // AcrPull works in this mode. In ABAC mode the registry expects the Container Registry Repository roles.
    roleAssignmentMode: 'LegacyRegistryPermissions'
    policies: {
      azureADAuthenticationAsArmPolicy: { status: 'enabled' }
    }
  }
}

// The project's identity pulls the studio agent image.
resource projectAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, project.id, acrPullRoleId)
  properties: {
    principalId: project.identity.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

module apps 'modules/apps.bicep' = if (deployApps) {
  name: 'apps'
  params: {
    location: location
    namePrefix: namePrefix
    logsName: logs.name
    acrName: acr.name
    brainImage: empty(brainImage) ? '${acr.properties.loginServer}/kite-brain:latest' : brainImage
    webImage: empty(webImage) ? '${acr.properties.loginServer}/kite-web:latest' : webImage
    brainEnv: {
      FOUNDRY_ENDPOINT: 'https://${foundryName}.services.ai.azure.com'
      ANSWER_DEPLOYMENT: models.answer.name
      FAST_DEPLOYMENT: models.fast.name
      DECISION_DEPLOYMENT: models.decision.name
      EMBED_DEPLOYMENT: models.embed.name
      CONTENT_SAFETY_ENDPOINT: foundry.properties.endpoint
      KITE_VOICES: kiteVoices
    }
    brainSecrets: union(appSecrets, {
      FOUNDRY_KEY: foundry.listKeys().key1
      CONTENT_SAFETY_KEY: foundry.listKeys().key1
    })
  }
  dependsOn: [
    deployments
  ]
}

output foundryAccountName string = foundry.name
output foundryEndpoint string = 'https://${foundryName}.services.ai.azure.com'
output anthropicBaseUrl string = 'https://${foundryName}.services.ai.azure.com/anthropic'
output contentSafetyEndpoint string = foundry.properties.endpoint
output projectName string = project.name
output projectEndpoint string = 'https://${foundryName}.services.ai.azure.com/api/projects/${project.name}'
output projectPrincipalId string = project.identity.principalId
output answerDeployment string = models.answer.name
output fastDeployment string = models.fast.name
output decisionDeployment string = models.decision.name
output embedDeployment string = models.embed.name
output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output brainUrl string = apps.?outputs.brainUrl ?? ''
output webUrl string = apps.?outputs.webUrl ?? ''
