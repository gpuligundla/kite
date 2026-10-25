// Container Apps for the brain and the web app. One replica each, because the brain's event bus lives in memory.

param location string
param namePrefix string
param logsName string
param acrName string
@description('The Foundry account the brain calls the studio agent on, with this identity.')
param foundryName string
param brainImage string
param webImage string

@description('Plain environment variables for the brain.')
param brainEnv object

@description('Environment variables for the brain that hold secrets. Empty values are skipped.')
@secure()
param brainSecrets object

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
var azureAiUserRoleId = '53ca6127-db72-4b80-b1b0-d745d6d5456d'
var secretVars = filter(objectKeys(brainSecrets), k => !empty(brainSecrets[k]))

resource logs 'Microsoft.OperationalInsights/workspaces@2025-02-01' existing = {
  name: logsName
}

resource acr 'Microsoft.ContainerRegistry/registries@2025-11-01' existing = {
  name: acrName
}

resource foundry 'Microsoft.CognitiveServices/accounts@2025-10-01-preview' existing = {
  name: foundryName
}

// A user-assigned identity exists before the apps do, so its grants are in place for the first pull and the
// first studio call. The apps pull images with it, and the brain signs its studio-agent calls with it.
resource pullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: '${namePrefix}-apps-id'
  location: location
}

resource appsAcrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: acr
  name: guid(acr.id, pullIdentity.id, acrPullRoleId)
  properties: {
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

// The brain invokes the kite-studio hosted agent with an Entra token for https://ai.azure.com.
resource appsAiUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: foundry
  name: guid(foundry.id, pullIdentity.id, azureAiUserRoleId)
  properties: {
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', azureAiUserRoleId)
  }
}

resource env 'Microsoft.App/managedEnvironments@2025-01-01' = {
  name: '${namePrefix}-apps'
  location: location
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logs.properties.customerId
        sharedKey: logs.listKeys().primarySharedKey
      }
    }
  }
}

var identity = {
  type: 'UserAssigned'
  userAssignedIdentities: { '${pullIdentity.id}': {} }
}
var registries = [
  {
    server: acr.properties.loginServer
    identity: pullIdentity.id
  }
]
var oneReplica = {
  minReplicas: 1
  maxReplicas: 1
}

resource brain 'Microsoft.App/containerApps@2025-01-01' = {
  name: '${namePrefix}-brain'
  location: location
  identity: identity
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: 8000
        allowInsecure: false
      }
      registries: registries
      // brainSecrets is @secure(). The linter can't follow a computed index into it.
      #disable-next-line use-secure-value-for-secure-inputs
      secrets: [for k in secretVars: { name: toLower(replace(k, '_', '-')), value: brainSecrets[k] }]
    }
    template: {
      containers: [
        {
          name: 'brain'
          image: brainImage
          // Remotion renders movies with headless Chrome inside this container.
          resources: {
            cpu: json('2.0')
            memory: '4Gi'
          }
          // AZURE_CLIENT_ID points DefaultAzureCredential at the user-assigned identity.
          env: concat(
            map(items(brainEnv), e => { name: e.key, value: e.value }),
            [{ name: 'AZURE_CLIENT_ID', value: pullIdentity.properties.clientId }],
            map(secretVars, k => { name: k, secretRef: toLower(replace(k, '_', '-')) })
          )
        }
      ]
      scale: oneReplica
    }
  }
  dependsOn: [
    appsAcrPull
    appsAiUser
  ]
}

resource web 'Microsoft.App/containerApps@2025-01-01' = {
  name: '${namePrefix}-web'
  location: location
  identity: identity
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      ingress: {
        external: true
        targetPort: 3000
        allowInsecure: false
      }
      registries: registries
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webImage
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'BRAIN_URL'
              value: 'https://${brain.properties.configuration.ingress.fqdn}'
            }
          ]
        }
      ]
      scale: oneReplica
    }
  }
  dependsOn: [
    appsAcrPull
  ]
}

output brainUrl string = 'https://${brain.properties.configuration.ingress.fqdn}'
output webUrl string = 'https://${web.properties.configuration.ingress.fqdn}'
