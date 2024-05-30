import {WebhookSubscription, WebhooksConfig} from './types/app_config_webhook.js'
import {WebhooksSchema} from './app_config_webhook_schemas/webhooks_schema.js'
import {ComplianceTopic} from './app_config_webhook_schemas/webhook_subscription_schema.js'
import {mergeAllWebhooks} from './transform/app_config_webhook.js'
import {
  CustomTransformationConfig,
  CustomTransformationConfigOptions,
  createConfigExtensionSpecification,
} from '../specification.js'
import {Flag} from '../../../services/dev/fetch.js'
import {compact, getPathValue} from '@shopify/cli-kit/common/object'

const PrivacyComplianceWebhooksTransformConfig: CustomTransformationConfig = {
  forward: (content: object, options?: CustomTransformationConfigOptions) =>
    transformToPrivacyComplianceWebhooksModule(content, options),
  reverse: (content: object, options?: CustomTransformationConfigOptions) =>
    transformFromPrivacyComplianceWebhooksModule(content, options),
}

export const PrivacyComplianceWebhooksSpecIdentifier = 'privacy_compliance_webhooks'

// Uses the same schema as the webhooks specs because its content is nested under the same webhooks section
const appPrivacyComplienceSpec = createConfigExtensionSpecification({
  identifier: PrivacyComplianceWebhooksSpecIdentifier,
  schema: WebhooksSchema,
  transformConfig: PrivacyComplianceWebhooksTransformConfig,
})

export default appPrivacyComplienceSpec

function transformToPrivacyComplianceWebhooksModule(content: object, options?: CustomTransformationConfigOptions) {
  const webhooks = getPathValue(content, 'webhooks') as WebhooksConfig
  const appUrl = options?.fullAppConfiguration?.application_url

  return compact({
    customers_redact_url: relativeUri(getCustomersDeletionUri(webhooks), appUrl),
    customers_data_request_url: relativeUri(getCustomersDataRequestUri(webhooks), appUrl),
    shop_redact_url: relativeUri(getShopDeletionUri(webhooks), appUrl),
  })
}

function transformFromPrivacyComplianceWebhooksModule(content: object, options?: {flags?: Flag[]}) {
  const customersRedactUrl = getPathValue(content, 'customers_redact_url') as string
  const customersDataRequestUrl = getPathValue(content, 'customers_data_request_url') as string
  const shopRedactUrl = getPathValue(content, 'shop_redact_url') as string

  if (options?.flags?.includes(Flag.DeclarativeWebhooks)) {
    const webhooks: WebhookSubscription[] = []
    if (customersDataRequestUrl) {
      webhooks.push({compliance_topics: [ComplianceTopic.CustomersDataRequest], uri: customersDataRequestUrl})
    }
    if (customersRedactUrl) {
      webhooks.push({compliance_topics: [ComplianceTopic.CustomersRedact], uri: customersRedactUrl})
    }
    if (shopRedactUrl) {
      webhooks.push({compliance_topics: [ComplianceTopic.ShopRedact], uri: shopRedactUrl})
    }

    if (webhooks.length === 0) return {}
    return {webhooks: {subscriptions: mergeAllWebhooks(webhooks), privacy_compliance: undefined}}
  }

  if (customersRedactUrl || customersDataRequestUrl || shopRedactUrl) {
    return {
      webhooks: {
        privacy_compliance: {
          ...(customersRedactUrl ? {customer_deletion_url: customersRedactUrl} : {}),
          ...(customersDataRequestUrl ? {customer_data_request_url: customersDataRequestUrl} : {}),
          ...(shopRedactUrl ? {shop_deletion_url: shopRedactUrl} : {}),
        },
      },
    }
  }
  return {}
}

function getComplianceUri(webhooks: WebhooksConfig, complianceTopic: string): string | undefined {
  return webhooks.subscriptions?.find((subscription) => subscription.compliance_topics?.includes(complianceTopic))?.uri
}

function relativeUri(uri?: string, appUrl?: string) {
  return appUrl && uri?.startsWith('/') ? `${appUrl}${uri}` : uri
}

function getCustomersDeletionUri(webhooks: WebhooksConfig) {
  return getComplianceUri(webhooks, 'customers/redact') || webhooks?.privacy_compliance?.customer_deletion_url
}

function getCustomersDataRequestUri(webhooks: WebhooksConfig) {
  return getComplianceUri(webhooks, 'customers/data_request') || webhooks?.privacy_compliance?.customer_data_request_url
}

function getShopDeletionUri(webhooks: WebhooksConfig) {
  return getComplianceUri(webhooks, 'shop/redact') || webhooks?.privacy_compliance?.shop_deletion_url
}
