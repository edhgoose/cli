import {PushConfig, PushConfigSchema, PushConfigVariables} from '../../../api/graphql/push_config.js'
import {ClearScopesSchema, clearRequestedScopes} from '../../../api/graphql/clear_requested_scopes.js'
import {App, GetConfig, GetConfigQuerySchema} from '../../../api/graphql/get_config.js'
import {
  AppConfiguration,
  CurrentAppConfiguration,
  isCurrentAppSchema,
  usesLegacyScopesBehavior,
  getAppScopesArray,
  AppInterface,
} from '../../../models/app/app.js'
import {DeleteAppProxySchema, deleteAppProxy} from '../../../api/graphql/app_proxy_delete.js'
import {confirmPushChanges} from '../../../prompts/config.js'
import {logMetadataForLoadedContext, renderCurrentlyUsedConfigInfo} from '../../context.js'
import {fetchOrgFromId} from '../../dev/fetch.js'
import {fetchPartnersSession} from '../../context/partner-account-info.js'
import {fetchSpecifications} from '../../generate/fetch-extension-specifications.js'
import {loadApp} from '../../../models/app/loader.js'
import {
  AppProxyConfiguration,
  AppProxySpecIdentifier,
} from '../../../models/extensions/specifications/app_config_app_proxy.js'
import {
  AppHomeConfiguration,
  AppHomeSpecIdentifier,
} from '../../../models/extensions/specifications/app_config_app_home.js'
import {partnersRequest} from '@shopify/cli-kit/node/api/partners'
import {AbortError} from '@shopify/cli-kit/node/error'
import {renderSuccess} from '@shopify/cli-kit/node/ui'
import {OutputMessage} from '@shopify/cli-kit/node/output'
import {basename, dirname} from '@shopify/cli-kit/node/path'
import {Config} from '@oclif/core'

export interface PushOptions {
  configuration: AppConfiguration
  force: boolean
  commandConfig: Config
}

const FIELD_NAMES: {[key: string]: string} = {
  title: 'name',
  api_key: 'client_id',
  redirect_url_whitelist: 'auth > redirect_urls',
  requested_access_scopes: 'access_scopes > scopes',
  webhook_api_version: 'webhooks > api_version',
  gdpr_webhooks: 'webhooks.privacy_compliance',
  'gdpr_webhooks,customer_deletion_url': 'webhooks.privacy_compliance > customer_deletion_url',
  'gdpr_webhooks,customer_data_request_url': 'webhooks.privacy_compliance > customer_data_request_url',
  'gdpr_webhooks,shop_deletion_url': 'webhooks.privacy_compliance > shop_deletion_url',
  proxy_sub_path: 'app_proxy > subpath',
  proxy_sub_path_prefix: 'app_proxy > prefix',
  proxy_url: 'app_proxy > url',
  preferences_url: 'app_preferences > url',
}

export async function pushConfig(options: PushOptions) {
  let configuration = options.configuration
  if (!isCurrentAppSchema(configuration)) return

  // Load local complete configuration
  const partnersSession = await fetchPartnersSession()
  const token = partnersSession.token
  const configFileName = isCurrentAppSchema(configuration) ? basename(configuration.path) : undefined
  const specifications = await fetchSpecifications({
    token,
    apiKey: configuration.client_id,
    config: options.commandConfig,
  })
  const localApp = await loadApp({
    directory: dirname(configuration.path),
    specifications,
    configName: configFileName,
  })
  configuration = localApp.configuration as CurrentAppConfiguration

  // Fetch remote configuration
  const queryVariables = {apiKey: configuration.client_id}
  const queryResult: GetConfigQuerySchema = await partnersRequest(GetConfig, token, queryVariables)
  if (!queryResult.app) abort("Couldn't find app. Make sure you have a valid client ID.")
  const {app} = queryResult

  const {businessName: org} = await fetchOrgFromId(app.organizationId, partnersSession)
  renderCurrentlyUsedConfigInfo({org, appName: app.title, configFile: configFileName})

  await logMetadataForLoadedContext(app)

  if (!(await confirmPushChanges(options.force, configuration, app, localApp.configSchema))) return

  const variables = getMutationVars(app, localApp)

  const result: PushConfigSchema = await partnersRequest(PushConfig, token, variables)

  if (result.appUpdate.userErrors.length > 0) {
    const errors = result.appUpdate.userErrors
      .map((error) => {
        const [_, ...fieldPath] = error.field || []
        const mappedName = FIELD_NAMES[fieldPath.join(',')] || fieldPath.join(', ')
        const fieldName = mappedName ? `${mappedName}: ` : ''
        return `${fieldName}${error.message}`
      })
      .join('\n')
    abort(errors)
  }

  const shouldDeleteScopes =
    app.requestedAccessScopes &&
    (configuration.access_scopes?.scopes === undefined || usesLegacyScopesBehavior(configuration))

  if (shouldDeleteScopes) {
    const clearResult: ClearScopesSchema = await partnersRequest(clearRequestedScopes, token, {apiKey: app.apiKey})

    if (clearResult.appRequestedAccessScopesClear?.userErrors?.length > 0) {
      const errors = clearResult.appRequestedAccessScopesClear.userErrors.map((error) => error.message).join(', ')
      abort(errors)
    }
  }

  if (!localApp.getConfigExtension(AppProxySpecIdentifier) && app.appProxy) {
    const deleteResult: DeleteAppProxySchema = await partnersRequest(deleteAppProxy, token, {apiKey: app.apiKey})

    if (deleteResult?.userErrors?.length > 0) {
      const errors = deleteResult.userErrors.map((error) => error.message).join(', ')
      abort(errors)
    }
  }

  renderSuccess({
    headline: `Updated your app config for ${configuration.name}`,
    body: [`Your ${configFileName} config is live for your app users.`],
  })
}

const getMutationVars = (app: App, localApp: AppInterface) => {
  let webhookApiVersion
  let gdprWebhooks
  const configuration = localApp.configuration as CurrentAppConfiguration

  if (app.betas?.declarativeWebhooks) {
    // These fields will be updated by the deploy command
    webhookApiVersion = app.webhookApiVersion
    gdprWebhooks = app.gdprWebhooks
  } else {
    webhookApiVersion = configuration.webhooks?.api_version
    gdprWebhooks = {
      customerDeletionUrl: configuration.webhooks?.privacy_compliance?.customer_deletion_url,
      customerDataRequestUrl: configuration.webhooks?.privacy_compliance?.customer_data_request_url,
      shopDeletionUrl: configuration.webhooks?.privacy_compliance?.shop_deletion_url,
    }
  }

  const appHomeSchema = localApp.getConfigExtension(AppHomeSpecIdentifier) as AppHomeConfiguration
  const variables: PushConfigVariables = {
    apiKey: configuration.client_id,
    title: configuration.name,
    applicationUrl: appHomeSchema.application_url,
    webhookApiVersion,
    redirectUrlAllowlist: configuration.auth?.redirect_urls ?? null,
    embedded: appHomeSchema.embedded ?? app.embedded,
    gdprWebhooks,
    posEmbedded: configuration.pos?.embedded ?? false,
    preferencesUrl: appHomeSchema.app_preferences?.url ?? null,
  }

  if (!usesLegacyScopesBehavior(configuration) && configuration.access_scopes?.scopes !== undefined) {
    variables.requestedAccessScopes = getAppScopesArray(configuration)
  }

  const appProxyConfig = localApp.getConfigExtension(AppProxySpecIdentifier) as AppProxyConfiguration
  if (appProxyConfig?.app_proxy) {
    variables.appProxy = {
      proxySubPath: appProxyConfig.app_proxy.subpath,
      proxySubPathPrefix: appProxyConfig.app_proxy.prefix,
      proxyUrl: appProxyConfig.app_proxy.url,
    }
  }

  return variables
}

export const abort = (errorMessage: OutputMessage) => {
  throw new AbortError(errorMessage)
}
