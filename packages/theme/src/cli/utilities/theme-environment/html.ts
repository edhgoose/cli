import {injectCdnProxy} from './proxy.js'
import {getInMemoryTemplates, injectHotReloadScript} from './hot-reload/server.js'
import {render} from './storefront-renderer.js'
import {
  defineEventHandler,
  setResponseHeaders,
  setResponseStatus,
  removeResponseHeader,
  getProxyRequestHeaders,
} from 'h3'
import {renderError} from '@shopify/cli-kit/node/ui'
import type {Theme} from '@shopify/cli-kit/node/themes/types'
import type {DevServerContext} from './types.js'

export function getHtmlHandler(theme: Theme, ctx: DevServerContext) {
  return defineEventHandler(async (event) => {
    const {path: urlPath, method, headers} = event

    // eslint-disable-next-line no-console
    console.log(`${method} ${urlPath}`)

    const response = await render(ctx.session, {
      path: urlPath,
      query: [],
      themeId: String(theme.id),
      cookies: headers.get('cookie') || '',
      sectionId: '',
      headers: getProxyRequestHeaders(event),
      replaceTemplates: getInMemoryTemplates(),
    }).catch(async (error: Error) => {
      const headline = 'Failed to render storefront.'
      renderError({headline, body: error.stack ?? error.message})
      await event.respondWith(
        new Response(
          getErrorPage({
            title: headline,
            header: headline,
            message: error.message,
            code: error.stack?.replace(`${error.message}\n`, '') ?? '',
          }),
          {status: 502, headers: {'content-type': 'text/html'}},
        ),
      )
    })

    if (!response) return

    setResponseStatus(event, response.status, response.statusText)

    const LinkHeader = response.headers.get('Link')
    setResponseHeaders(event, {
      ...Object.fromEntries(response.headers.entries()),
      Link: LinkHeader && injectCdnProxy(LinkHeader, ctx),
    })

    // We are decoding the payload here, remove the header:
    let html = await response.text()
    removeResponseHeader(event, 'content-encoding')

    html = injectCdnProxy(html, ctx)

    if (ctx.options.liveReload !== 'off') {
      html = injectHotReloadScript(html)
    }

    return html
  })
}

function getErrorPage(options: {title: string; header: string; message: string; code: string}) {
  const html = String.raw

  return html`<html>
    <head>
      <title>${options.title ?? 'Unknown error'}</title>
    </head>
    <body style="display: flex; flex-direction: column; align-items: center; padding-top: 20px; font-family: Arial">
      <h2>${options.header}</h2>
      <p>${options.message}</p>
      <pre>${options.code}</pre>
    </body>
  </html>`
}
