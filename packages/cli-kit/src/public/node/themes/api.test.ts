import {
  createTheme,
  themeDelete,
  fetchThemes,
  ThemeParams,
  themeUpdate,
  themePublish,
  fetchChecksums,
  bulkUploadThemeAssets,
  AssetParams,
  deleteThemeAsset,
} from './api.js'
import {RemoteBulkUploadResponse} from './factories.js'
import {ThemeDelete} from '../../../cli/api/graphql/admin/generated/theme_delete.js'
import {ThemeUpdate} from '../../../cli/api/graphql/admin/generated/theme_update.js'
import {ThemePublish} from '../../../cli/api/graphql/admin/generated/theme_publish.js'
import {test, vi, expect, describe} from 'vitest'
import {adminRequestDoc, restRequest} from '@shopify/cli-kit/node/api/admin'
import {AbortError} from '@shopify/cli-kit/node/error'

vi.mock('@shopify/cli-kit/node/api/admin')
vi.mock('@shopify/cli-kit/node/system')

const session = {token: 'token', storeFqdn: 'my-shop.myshopify.com'}
const themeAccessSession = {...session, token: 'shptka_token'}
const sessions = {CLI: session, 'Theme Access': themeAccessSession}

describe('fetchThemes', () => {
  test('returns store themes', async () => {
    // Given
    vi.mocked(restRequest).mockResolvedValue({
      json: {
        themes: [
          {id: 123, name: 'store theme 1', processing: false},
          {id: 456, name: 'store theme 2', processing: true},
        ],
      },
      status: 200,
      headers: {},
    })

    // When
    const themes = await fetchThemes(session)

    // Then
    expect(restRequest).toHaveBeenCalledWith('GET', '/themes', session, undefined, {fields: 'id,name,role,processing'})
    expect(themes).toHaveLength(2)

    expect(themes[0]!.id).toEqual(123)
    expect(themes[1]!.id).toEqual(456)

    expect(themes[0]!.name).toEqual('store theme 1')
    expect(themes[1]!.name).toEqual('store theme 2')

    expect(themes[0]!.processing).toBeFalsy()
    expect(themes[1]!.processing).toBeTruthy()
  })
})

describe('fetwchChecksums', () => {
  test('returns theme checksums', async () => {
    // Given
    vi.mocked(restRequest).mockResolvedValue({
      json: {
        assets: [
          {
            key: 'snippets/product-variant-picker.liquid',
            checksum: '29e2e56057c3b58c02bc7946d7600481',
          },
          {
            key: 'templates/404.json',
            checksum: 'f14a0bd594f4fee47b13fc09543098ff',
          },
          {
            key: 'templates/article.json',
            // May be null if an asset has not been updated recently.
            checksum: null,
          },
        ],
      },
      status: 200,
      headers: {},
    })

    // When
    const id = 123
    const checksum = await fetchChecksums(id, session)

    // Then
    expect(restRequest).toHaveBeenCalledWith('GET', `/themes/${id}/assets`, session, undefined, {
      fields: 'key,checksum',
    })
    expect(checksum).toHaveLength(3)
    expect(checksum[0]!.key).toEqual('snippets/product-variant-picker.liquid')
    expect(checksum[1]!.key).toEqual('templates/404.json')
    expect(checksum[2]!.key).toEqual('templates/article.json')
    expect(checksum[0]!.checksum).toEqual('29e2e56057c3b58c02bc7946d7600481')
    expect(checksum[1]!.checksum).toEqual('f14a0bd594f4fee47b13fc09543098ff')
    expect(checksum[2]!.checksum).toEqual(null)
  })
})

describe('createTheme', () => {
  test('creates a theme', async () => {
    // Given
    const id = 123
    const name = 'new theme'
    const role = 'unpublished'
    const processing = false
    const params: ThemeParams = {name, role}

    vi.mocked(restRequest)
      .mockResolvedValueOnce({
        json: {theme: {id, name, role, processing}},
        status: 200,
        headers: {},
      })
      .mockResolvedValueOnce({
        json: {
          results: [],
        },
        status: 207,
        headers: {},
      })

    // When
    const theme = await createTheme(params, session)

    // Then
    expect(restRequest).toHaveBeenCalledWith('POST', '/themes', session, {theme: params}, {})
    expect(theme).not.toBeNull()
    expect(theme!.id).toEqual(id)
    expect(theme!.name).toEqual(name)
    expect(theme!.role).toEqual(role)
    expect(theme!.processing).toBeFalsy()
  })
})

describe('themeUpdate', () => {
  for (const [sessionType, session] of Object.entries(sessions)) {
    test(`updates a theme with graphql with a ${sessionType} session`, async () => {
      // Given
      const id = 123
      const name = 'updated theme'
      const role = 'unpublished'
      const params: ThemeParams = {name, role}

      vi.mocked(adminRequestDoc).mockResolvedValue({
        themeUpdate: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${id}`,
            name,
            role,
          },
        },
      })

      // When
      const theme = await themeUpdate(id, params, session)

      // Then
      expect(adminRequestDoc).toHaveBeenCalledWith(ThemeUpdate, session, {
        id: `gid://shopify/OnlineStoreTheme/${id}`,
        input: {name},
      })
      expect(theme).not.toBeNull()
      expect(theme!.id).toEqual(id)
      expect(theme!.name).toEqual(name)
      expect(theme!.role).toEqual(role)
    })
  }
})

describe('themePublish', () => {
  for (const [sessionType, session] of Object.entries(sessions)) {
    test(`publish a theme with graphql with a ${sessionType} session`, async () => {
      // Given
      const id = 123
      const name = 'updated theme'
      const role = 'live'

      vi.mocked(adminRequestDoc).mockResolvedValue({
        themePublish: {
          theme: {
            id: `gid://shopify/OnlineStoreTheme/${id}`,
            name,
            role,
          },
        },
      })

      // When
      const theme = await themePublish(id, session)

      // Then
      expect(adminRequestDoc).toHaveBeenCalledWith(ThemePublish, session, {id: `gid://shopify/OnlineStoreTheme/${id}`})
      expect(theme).not.toBeNull()
      expect(theme!.id).toEqual(id)
      expect(theme!.name).toEqual(name)
      expect(theme!.role).toEqual(role)
    })
  }
})

describe('deleteThemeAsset', () => {
  test('deletes a theme asset', async () => {
    // Given
    const id = 123
    const key = 'snippets/product-variant-picker.liquid'

    vi.mocked(restRequest).mockResolvedValue({
      json: {message: 'snippets/product-variant-picker.liquid was succesfully deleted'},
      status: 200,
      headers: {},
    })

    // When
    const output = await deleteThemeAsset(id, key, session)

    // Then
    expect(restRequest).toHaveBeenCalledWith('DELETE', `/themes/${id}/assets`, session, undefined, {'asset[key]': key})
    expect(output).toBe(true)
  })

  test('returns true when attemping to delete an nonexistent asset', async () => {
    // Given
    const id = 123
    const key = 'snippets/product-variant-picker.liquid'

    vi.mocked(restRequest).mockResolvedValue({
      json: {},
      status: 200,
      headers: {},
    })

    // When
    const output = await deleteThemeAsset(id, key, session)

    // Then
    expect(restRequest).toHaveBeenCalledWith('DELETE', `/themes/${id}/assets`, session, undefined, {'asset[key]': key})
    expect(output).toBe(true)
  })
})

describe('themeDelete', () => {
  for (const [sessionType, session] of Object.entries(sessions)) {
    test(`deletes a theme with graphql with a ${sessionType} session`, async () => {
      // Given
      const id = 123
      const name = 'store theme'

      vi.mocked(adminRequestDoc).mockResolvedValue({
        themeDelete: {
          deletedThemeId: 'gid://shopify/OnlineStoreTheme/123',
        },
      })

      // When
      const response = await themeDelete(id, session)

      // Then
      expect(adminRequestDoc).toHaveBeenCalledWith(ThemeDelete, session, {id: `gid://shopify/OnlineStoreTheme/${id}`})
      expect(response).toBe(true)
    })
  }
})

describe('request errors', () => {
  test(`returns AbortError when graphql returns user error`, async () => {
    // Given

    vi.mocked(adminRequestDoc).mockResolvedValue({
      themeDelete: {
        deletedThemeId: null,
        userErrors: [{message: 'Could not delete theme'}],
      },
    })

    await expect(async () => {
      // When
      return themeDelete(1, session)

      // Then
    }).rejects.toThrowError(AbortError)
  })
})

describe('bulkUploadThemeAssets', async () => {
  test('uploads multiple assets', async () => {
    const id = 123
    const assets: AssetParams[] = [
      {key: 'snippets/product-variant-picker.liquid', value: 'content'},
      {key: 'templates/404.json', value: 'to_be_replaced_with_hash'},
    ]

    const mockResults: RemoteBulkUploadResponse[] = [
      {
        code: 200,
        body: {
          asset: {
            key: 'assets/test.liquid',
            checksum: '3f26c8569292ce6f1cc991c5fa7d3fcb',
            attachment: '',
            value: '',
          },
        },
      },
      {
        code: 400,
        body: {
          errors: {asset: ['expected Hash to be a String']},
        },
      },
    ]

    vi.mocked(restRequest).mockResolvedValue({
      json: {results: mockResults},
      status: 207,
      headers: {},
    })

    // When
    const bulkUploadresults = await bulkUploadThemeAssets(id, assets, session)

    // Then
    expect(restRequest).toHaveBeenCalledWith(
      'PUT',
      `/themes/${id}/assets/bulk`,
      session,
      {
        assets: [
          {key: 'snippets/product-variant-picker.liquid', value: 'content'},
          {key: 'templates/404.json', value: 'to_be_replaced_with_hash'},
        ],
      },
      {},
    )
    expect(bulkUploadresults).toHaveLength(2)
    expect(bulkUploadresults[0]).toEqual({
      key: 'snippets/product-variant-picker.liquid',
      success: true,
      errors: {},
      operation: 'UPLOAD',
      asset: {
        attachment: '',
        key: 'assets/test.liquid',
        checksum: '3f26c8569292ce6f1cc991c5fa7d3fcb',
        value: '',
      },
    })
    expect(bulkUploadresults[1]).toEqual({
      key: 'templates/404.json',
      operation: 'UPLOAD',
      success: false,
      errors: {asset: ['expected Hash to be a String']},
      asset: undefined,
    })
  })

  test('throws an error when the server responds with a 404', async () => {
    const id = 123
    const assets: AssetParams[] = [
      {key: 'snippets/product-variant-picker.liquid', value: 'content'},
      {key: 'templates/404.json', value: 'to_be_replaced_with_hash'},
    ]

    vi.mocked(restRequest).mockResolvedValue({
      json: {},
      status: 404,
      headers: {},
    })

    // When
    await expect(async () => {
      return bulkUploadThemeAssets(id, assets, session)
      // Then
    }).rejects.toThrowError(AbortError)
  })

  test('throws an error when the server responds with a 403', async () => {
    // Given
    const id = 123
    const assets: AssetParams[] = [
      {key: 'snippets/product-variant-picker.liquid', value: 'content'},
      {key: 'templates/404.json', value: 'to_be_replaced_with_hash'},
    ]
    const message = `Cannot delete generated asset 'assets/bla.css'. Delete 'assets/bla.css.liquid' instead.`

    vi.mocked(restRequest).mockResolvedValue({
      json: {
        message,
      },
      status: 403,
      headers: {},
    })

    // When
    await expect(async () => {
      return bulkUploadThemeAssets(id, assets, session)

      // Then
    }).rejects.toThrowError(new AbortError(message))
  })
})
