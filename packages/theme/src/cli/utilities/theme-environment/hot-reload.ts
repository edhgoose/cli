// eslint-disable-next-line spaced-comment, @typescript-eslint/triple-slash-reference
/// <reference lib="dom" />
import {render} from './storefront-renderer.js'
import {THEME_DEFAULT_IGNORE_PATTERNS, THEME_DIRECTORY_PATTERNS} from '../theme-fs.js'
import {
  createEventStream,
  defineEventHandler,
  getProxyRequestHeaders,
  getQuery,
  removeResponseHeader,
  setResponseHeaders,
  setResponseStatus,
} from 'h3'
import {renderWarning} from '@shopify/cli-kit/node/ui'
import {extname, joinPath, relativePath} from '@shopify/cli-kit/node/path'
import {readFile} from '@shopify/cli-kit/node/fs'
import EventEmitter from 'node:events'
import type {Theme} from '@shopify/cli-kit/node/themes/types'
import type {DevServerContext} from './types.js'

interface TemplateWithSections {
  sections?: {[key: string]: {type: string}}
}

const eventEmitter = new EventEmitter()
const inMemoryTemplates = {} as {[key: string]: string}
const parsedJsonTemplates = {} as {[key: string]: TemplateWithSections}

type HotReloadEvent =
  | {
      type: 'section'
      key: string
      names: string[]
    }
  | {
      type: 'other'
      key: string
    }

function emitHotReloadEvent(event: HotReloadEvent) {
  eventEmitter.emit('hot-reload', event)
}

function getInMemoryTemplates() {
  return {...inMemoryTemplates}
}

function setInMemoryTemplate(key: string, content: string) {
  inMemoryTemplates[key] = content
  if (key.endsWith('.json')) {
    parsedJsonTemplates[key] = JSON.parse(content)
  }
}

function deleteInMemoryTemplate(key: string) {
  delete inMemoryTemplates[key]
  delete parsedJsonTemplates[key]
}

export async function setupTemplateWatcher(ctx: DevServerContext) {
  const {default: chokidar} = await import('chokidar')

  const directoriesToWatch = new Set(
    THEME_DIRECTORY_PATTERNS.map((pattern) => joinPath(ctx.directory, pattern.split('/').shift() ?? '')),
  )

  let initialized = false
  const getKey = (filePath: string) => relativePath(ctx.directory, filePath)
  const handleFileUpdate = (filePath: string) => {
    const extension = extname(filePath)

    const key = getKey(filePath)

    if (['.liquid', '.json'].includes(extension)) {
      // During initialization we only want to process
      // JSON files to cache their contents early
      if (initialized || extension === '.json') {
        readFile(filePath)
          .then((content) => {
            setInMemoryTemplate(key, content)
            triggerHotReload(key)
          })
          .catch((error) => renderWarning({headline: `Failed to read file ${filePath}: ${error.message}`}))
      }
    } else if (initialized) {
      triggerHotReload(key)
    }
  }

  chokidar
    .watch([...directoriesToWatch], {
      ignored: THEME_DEFAULT_IGNORE_PATTERNS,
      persistent: true,
      ignoreInitial: false,
    })
    .on('ready', () => (initialized = true))
    .on('add', handleFileUpdate)
    .on('change', handleFileUpdate)
    .on('unlink', (filePath) => deleteInMemoryTemplate(getKey(filePath)))

  return {getInMemoryTemplates}
}

export function getHotReloadHandler(theme: Theme, ctx: DevServerContext) {
  return defineEventHandler(async (event) => {
    const endpoint = event.path.split('?')[0]

    if (endpoint === '/__hot-reload/subscribe') {
      const eventStream = createEventStream(event)

      eventEmitter.on('hot-reload', (event: HotReloadEvent) => {
        eventStream.push(JSON.stringify(event)).catch((error: Error) => {
          renderWarning({headline: 'Failed to send HotReload event.', body: error?.stack})
        })
      })

      return eventStream.send()
    } else if (endpoint === '/__hot-reload/render') {
      const queryParams = getQuery(event)
      const sectionId = queryParams['section-id']
      const sectionKey = queryParams['section-template-name']

      if (typeof sectionId !== 'string' || typeof sectionKey !== 'string') {
        return
      }

      const sectionTemplate = inMemoryTemplates[sectionKey]
      if (!sectionTemplate) {
        renderWarning({headline: 'No template found for HotReload event.', body: `Template ${sectionKey} not found.`})
        return
      }

      const response = await render(ctx.session, {
        path: '/',
        query: [],
        themeId: String(theme.id),
        cookies: event.headers.get('cookie') || '',
        sectionId,
        headers: getProxyRequestHeaders(event),
        replaceTemplates: {[sectionKey]: sectionTemplate},
      })

      setResponseStatus(event, response.status, response.statusText)
      setResponseHeaders(event, Object.fromEntries(response.headers.entries()))
      removeResponseHeader(event, 'content-encoding')

      return response.text()
    }
  })
}

function triggerHotReload(key: string) {
  const type = key.split('/')[0]

  if (type === 'sections') {
    hotReloadSections(key)
  } else {
    emitHotReloadEvent({type: 'other', key})
  }
}

function hotReloadSections(key: string) {
  const sectionId = key.match(/^sections\/(.+)\.liquid$/)?.[1]
  if (!sectionId) return

  const sectionsToUpdate: string[] = []
  for (const {sections} of Object.values(parsedJsonTemplates)) {
    for (const [name, {type}] of Object.entries(sections || {})) {
      if (type === sectionId) {
        sectionsToUpdate.push(name)
      }
    }
  }

  emitHotReloadEvent({type: 'section', key, names: sectionsToUpdate})
}

function injectFunction(fn: () => void) {
  return `<script>(${fn.toString()})()</script>`
}

export function injectHotReloadScript(html: string) {
  // These function run in the browser:

  function hotReloadScript() {
    const prefix = '[HotReload]'
    // eslint-disable-next-line no-console
    const logInfo = console.info.bind(console, prefix)
    // eslint-disable-next-line no-console
    const logError = console.error.bind(console, prefix)

    const fullPageReload = (key: string, error?: Error) => {
      if (error) logError(error)
      logInfo('Full reload:', key)
      window.location.reload()
    }

    const evtSource = new EventSource('/__hot-reload/subscribe', {withCredentials: true})

    evtSource.onopen = () => logInfo('Connected')
    evtSource.onerror = () => {
      logError('Connection error, trying to reconnect...')
      setTimeout(hotReloadScript, 2000)
    }

    evtSource.onmessage = async (event) => {
      if (typeof event.data !== 'string') return

      const data = JSON.parse(event.data) as HotReloadEvent
      if (data.type === 'section') {
        const elements = data.names.flatMap((name) =>
          Array.from(document.querySelectorAll(`[id^='shopify-section'][id$='${name}']`)),
        )

        if (elements.length > 0) {
          const controller = new AbortController()

          await Promise.all(
            elements.map(async (element) => {
              const sectionId = element.id.replace(/^shopify-section-/, '')
              const response = await fetch(
                `/__hot-reload/render?section-id=${encodeURIComponent(
                  sectionId,
                )}&section-template-name=${encodeURIComponent(data.key)}`,
                {signal: controller.signal},
              )

              if (!response.ok) {
                throw new Error(`Hot reload request failed: ${response.statusText}`)
              }

              const updatedSection = await response.text()

              // SFR will send a header to indicate it used the replace-templates
              // to render the section. If it didn't, we need to do a full reload.
              if (response.headers.get('x-templates-from-params') === '1') {
                // eslint-disable-next-line require-atomic-updates
                element.outerHTML = updatedSection
              } else {
                controller.abort('Full reload required')
                fullPageReload(data.key, new Error('Hot reload not supported for this section.'))
              }
            }),
          ).catch((error: Error) => {
            controller.abort('Request error')
            fullPageReload(data.key, error)
          })

          logInfo(`Updated sections for "${data.key}":`, data.names)
        }
      } else if (data.type === 'other') {
        fullPageReload(data.key)
      }
    }
  }

  return html.replace(/<\/head>/, `${injectFunction(hotReloadScript)}</head>`)
}