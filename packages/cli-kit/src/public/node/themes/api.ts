import {storeAdminUrl} from './urls.js'
import * as throttler from '../../../private/node/themes/themes-api/throttler.js'
import {apiCallLimit, retryAfter} from '../../../private/node/themes/themes-api/headers.js'
import {retry} from '../../../private/node/themes/themes-api/retry.js'
import {adminRequest, restRequest, RestResponse} from '@shopify/cli-kit/node/api/admin'
import {AdminSession} from '@shopify/cli-kit/node/session'
import {AbortError} from '@shopify/cli-kit/node/error'
import {
  buildBulkUploadResults,
  buildChecksum,
  buildTheme,
  buildThemeAsset,
} from '@shopify/cli-kit/node/themes/factories'
import {Result, Checksum, Key, Theme, ThemeAsset} from '@shopify/cli-kit/node/themes/types'
import {gql} from 'graphql-request'

export type ThemeParams = Partial<Pick<Theme, 'name' | 'role' | 'processing'>>
export type AssetParams = Pick<ThemeAsset, 'key'> & Partial<Pick<ThemeAsset, 'value' | 'attachment'>>

export async function fetchTheme(id: number, session: AdminSession): Promise<Theme | undefined> {
  const response = await request('GET', `/themes/${id}`, session, undefined, {fields: 'id,name,role,processing'})
  return buildTheme(response.json.theme)
}

interface FetchThemesResponse {
  themes: {
    pageInfo: {
      hasNextPage: boolean
      endCursor: string
    }
    nodes: Theme[]
  }
}

export async function fetchThemes(session: AdminSession): Promise<Theme[]> {
  let cursor = null
  const themes: Theme[] = []
  while (true) {
    // eslint-disable-next-line no-await-in-loop
    const response: FetchThemesResponse = await adminRequest(
      gql`
      query {
        themes(first: 50, after: ${cursor}) {
          nodes {
            id
            name
            role
            prefix
          }
          pageInfo {
            hasNextPage
            endCursor
          }
        }
      }
    `,
      session,
    )
    response.themes.nodes.forEach((theme) => {
      theme.role = theme.role.toLowerCase()
      // Strip off gid://shopify/Theme/ from the id
      theme.id = parseInt((<string>(<unknown>theme.id)).split('/').pop() as string, 10)

      const t = buildTheme(theme)
      if (t !== undefined) {
        themes.push(t)
      }
    })
    if (response.themes.pageInfo.hasNextPage) {
      cursor = `"${response.themes.pageInfo.endCursor}"`
    } else {
      return themes
    }
  }
}

export async function createTheme(params: ThemeParams, session: AdminSession): Promise<Theme | undefined> {
  const response = await request('POST', '/themes', session, {theme: {...params}})
  return buildTheme({...response.json.theme, createdAtRuntime: true})
}

export async function fetchThemeAsset(id: number, key: Key, session: AdminSession): Promise<ThemeAsset | undefined> {
  const response = await request('GET', `/themes/${id}/assets`, session, undefined, {
    'asset[key]': key,
  })
  return buildThemeAsset(response.json.asset)
}

export async function fetchThemeAssets(
  id: number,
  filenames: Key[],
  session: AdminSession,
): Promise<ThemeAsset[] | undefined> {
  var assets: ThemeAsset[] = []
  var cursor = ''
  while (true) {
    const response: any = await adminRequest(
      gql`
      query {
        theme(id: "gid://shopify/Theme/${id}") {
          files(first: 100, after: "${cursor}", filenames: ${JSON.stringify(filenames)}) {
            nodes {
              filename
              file {
                checksum
                body {
                  ... on ThemeFileBodyText { content }
                  ... on ThemeFileBodyBase64 { contentBase64 }
                  ... on ThemeFileBodyUrl { url }
                }
              }
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
      `,
      session,
    )
    response.theme.files.nodes.forEach((file: any) => {
      if (file.file.body.url) {
        console.log(`${file.filename} has url content`)
        throw new Error('URL content not supported yet')
      }
      assets.push({
        key: file.filename as string,
        checksum: file.file.checksum as string,
        value: file.file.body.content,
        attachment: file.file.body.contentBase64,
      })
    })
    if (response.theme.files.pageInfo.hasNextPage) {
      cursor = response.theme.files.pageInfo.endCursor
    } else {
      return assets
    }
  }
}

export async function deleteThemeAsset(id: number, key: Key, session: AdminSession): Promise<boolean> {
  const response = await request('DELETE', `/themes/${id}/assets`, session, undefined, {
    'asset[key]': key,
  })
  return Boolean(response.json.message)
}

export async function bulkUploadThemeAssets(
  id: number,
  assets: AssetParams[],
  session: AdminSession,
): Promise<Result[]> {
  const response = await request('PUT', `/themes/${id}/assets/bulk`, session, {assets})
  if (response.status !== 207) {
    throw new AbortError('Upload failed, could not reach the server')
  }
  return buildBulkUploadResults(response.json.results, assets)
}

export async function fetchChecksums(id: number, session: AdminSession): Promise<Checksum[]> {
  var checksums: Checksum[] = []

  var cursor = ''
  while (true) {
    const response: any = await adminRequest(
      gql`
      query {
        theme(id: "gid://shopify/Theme/${id}") {
          files(first: 250, after: "${cursor}") {
            nodes {
              filename
              file { checksum }
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
      `,
      session,
    )
    response.theme.files.nodes.forEach((file: any) => {
      checksums.push({key: file.filename, checksum: file.file.checksum})
    })
    if (response.theme.files.pageInfo.hasNextPage) {
      cursor = response.theme.files.pageInfo.endCursor
    } else {
      return checksums
    }
  }
}

interface UpgradeThemeOptions {
  fromTheme: number
  toTheme: number
  script?: string
  session: AdminSession
}

export async function upgradeTheme(upgradeOptions: UpgradeThemeOptions): Promise<Theme | undefined> {
  const {fromTheme, toTheme, session, script} = upgradeOptions
  const params = {from_theme: fromTheme, to_theme: toTheme, ...(script && {script})}
  const response = await request('POST', `/themes`, session, params)
  return buildTheme(response.json.theme)
}

export async function updateTheme(id: number, params: ThemeParams, session: AdminSession): Promise<Theme | undefined> {
  const response = await request('PUT', `/themes/${id}`, session, {theme: {id, ...params}})
  return buildTheme(response.json.theme)
}

export async function publishTheme(id: number, session: AdminSession): Promise<Theme | undefined> {
  return updateTheme(id, {role: 'main'}, session)
}

export async function deleteTheme(id: number, session: AdminSession): Promise<Theme | undefined> {
  const response = await request('DELETE', `/themes/${id}`, session)
  return buildTheme(response.json.theme)
}

async function request<T>(
  method: string,
  path: string,
  session: AdminSession,
  params?: T,
  searchParams: {[name: string]: string} = {},
): Promise<RestResponse> {
  const response = await throttler.throttle(() => restRequest(method, path, session, params, searchParams))

  const status = response.status
  const callLimit = apiCallLimit(response)

  throttler.updateApiCallLimit(callLimit)

  switch (true) {
    case status >= 200 && status <= 399:
      // Returns the successful reponse
      return response
    case status === 404:
      // Defer the decision when a resource is not found
      return response
    case status === 429:
      // Retry following the "retry-after" header
      return retry(() => request(method, path, session, params, searchParams), retryAfter(response))
    case status === 403:
      return handleForbiddenError(session)
    case status === 401:
      throw new AbortError(`[${status}] API request unauthorized error`)
    case status === 422:
      throw new AbortError(`[${status}] API request unprocessable content: ${errors(response)}`)
    case status >= 400 && status <= 499:
      throw new AbortError(`[${status}] API request client error`)
    case status >= 500 && status <= 599:
      throw new AbortError(`[${status}] API request server error`)
    default:
      throw new AbortError(`[${status}] API request unexpected error`)
  }
}

function handleForbiddenError(session: AdminSession): never {
  const store = session.storeFqdn
  const adminUrl = storeAdminUrl(session)

  throw new AbortError(
    `You are not authorized to edit themes on "${store}".`,
    "You can't use Shopify CLI with development stores if you only have Partner staff " +
      'member access. If you want to use Shopify CLI to work on a development store, then ' +
      'you should be the store owner or create a staff account on the store.' +
      '\n\n' +
      "If you're the store owner, then you need to log in to the store directly using the " +
      `store URL at least once (for example, using "${adminUrl}") before you log in using ` +
      'Shopify CLI. Logging in to the Shopify admin directly connects the development ' +
      'store with your Shopify login.',
  )
}

function errors(response: RestResponse) {
  return JSON.stringify(response.json?.errors)
}
