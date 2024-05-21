import {loadLocalExtensionsSpecifications} from '../../models/extensions/load-specifications.js'
import {FlattenedRemoteSpecification, RemoteSpecification} from '../../api/graphql/extension_specifications.js'
import {ExtensionSpecification, RemoteAwareExtensionSpecification} from '../../models/extensions/specification.js'
import {DeveloperPlatformClient} from '../../utilities/developer-platform-client.js'
import {getArrayRejectingUndefined} from '@shopify/cli-kit/common/array'
import {outputDebug} from '@shopify/cli-kit/node/output'

interface FetchSpecificationsOptions {
  developerPlatformClient: DeveloperPlatformClient
  apiKey: string
}
/**
 * Returns all extension specifications the user has access to.
 * This includes:
 * - UI extensions
 * - Theme extensions
 *
 * Will return a merge of the local and remote specifications (remote values override local ones)
 * - Will only return the specifications that are defined in both places.
 * - "deprecated" extension specifications aren't included
 *
 * @param developerPlatformClient - The client to access the platform API
 * @returns List of extension specifications
 */
export async function fetchSpecifications({
  developerPlatformClient,
  apiKey,
}: FetchSpecificationsOptions): Promise<RemoteAwareExtensionSpecification[]> {
  const result: RemoteSpecification[] = await developerPlatformClient.specifications(apiKey)

  const extensionSpecifications: FlattenedRemoteSpecification[] = result
    .filter((specification) => ['extension', 'configuration'].includes(specification.experience))
    .map((spec) => {
      const newSpec = spec as FlattenedRemoteSpecification
      // WORKAROUND: The identifiers in the API are different for these extensions to the ones the CLI
      // has been using so far. This is a workaround to keep the CLI working until the API is updated.
      if (spec.identifier === 'theme_app_extension') spec.identifier = 'theme'
      if (spec.identifier === 'subscription_management') spec.identifier = 'product_subscription'
      newSpec.registrationLimit = spec.options.registrationLimit
      newSpec.surface = spec.features?.argo?.surface

      // Hardcoded value for the post purchase extension because the value is wrong in the API
      if (spec.identifier === 'checkout_post_purchase') newSpec.surface = 'post_purchase'

      return newSpec
    })

  const local = await loadLocalExtensionsSpecifications()
  const updatedSpecs = mergeLocalAndRemoteSpecs(local, extensionSpecifications)
  return [...updatedSpecs]
}

function mergeLocalAndRemoteSpecs(
  local: ExtensionSpecification[],
  remote: FlattenedRemoteSpecification[],
): RemoteAwareExtensionSpecification[] {
  const updated = local.map((spec) => {
    const remoteSpec = remote.find((remote) => remote.identifier === spec.identifier)
    if (remoteSpec) return {...spec, ...remoteSpec, loadedRemoteSpecs: true} as RemoteAwareExtensionSpecification
    return undefined
  })

  const result = getArrayRejectingUndefined<RemoteAwareExtensionSpecification>(updated)

  // Log the specs that were defined locally but aren't in the result
  // This usually means the spec is a gated one and the caller doesn't have adequate access. Or, we're in a test and
  // the mocked specification set is missing something.
  const missing = local.filter((spec) => !result.find((result) => result.identifier === spec.identifier))
  if (missing.length > 0) {
    outputDebug(
      `The following extension specifications were defined locally but not found in the remote specifications: ${missing
        .map((spec) => spec.identifier)
        .sort()
        .join(', ')}`,
    )
  }

  return result
}
