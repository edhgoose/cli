import {createConfigExtensionSpecification} from '../specification.js'
import {zod} from '@shopify/cli-kit/node/schema'

const AppAccessSchema = zod.object({
  access: zod
    .object({
      api_access: zod
        .union([
          zod.literal(true),
          zod.object({
            mode: zod.enum(['online', 'offline']),
          }),
        ])
        .optional(),
    })
    .optional(),
})

const spec = createConfigExtensionSpecification({
  identifier: 'app_access',
  schema: AppAccessSchema,
})

export default spec