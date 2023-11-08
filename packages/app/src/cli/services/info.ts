import {outputEnv} from './app/env/show.js'
import {getAppContext} from './context.js'
import {fetchPartnersSession, isServiceAccount, isUserAccount} from './context/partner-account-info.js'
import {AppInterface, getAppScopes} from '../models/app/app.js'
import {configurationFileNames} from '../constants.js'
import {ExtensionInstance} from '../models/extensions/extension-instance.js'
import {platformAndArch} from '@shopify/cli-kit/node/os'
import {checkForNewVersion} from '@shopify/cli-kit/node/node-package-manager'
import {linesToColumns} from '@shopify/cli-kit/common/string'
import {relativePath} from '@shopify/cli-kit/node/path'
import {
  OutputMessage,
  outputContent,
  outputToken,
  formatSection,
  stringifyMessage,
  getOutputUpdateCLIReminder,
} from '@shopify/cli-kit/node/output'

export type Format = 'json' | 'text'
export interface InfoOptions {
  format: Format
  configName?: string
  /** When true the command outputs the env. variables necessary to deploy and run web/ */
  webEnv: boolean
}
interface Configurable {
  type: string
  externalType: string
}

export async function info(app: AppInterface, options: InfoOptions): Promise<OutputMessage> {
  if (options.webEnv) {
    return infoWeb(app, options)
  } else {
    return infoApp(app, options)
  }
}

export async function infoWeb(app: AppInterface, {format}: InfoOptions): Promise<OutputMessage> {
  return outputEnv(app, format)
}

export async function infoApp(app: AppInterface, options: InfoOptions): Promise<OutputMessage> {
  if (options.format === 'json') {
    return outputContent`${JSON.stringify(app, null, 2)}`
  } else {
    const appInfo = new AppInfo(app, options)
    return appInfo.output()
  }
}

const UNKNOWN_TEXT = outputContent`${outputToken.italic('unknown')}`.value
const NOT_CONFIGURED_TEXT = outputContent`${outputToken.italic('Not yet configured')}`.value

class AppInfo {
  private app: AppInterface
  private options: InfoOptions

  constructor(app: AppInterface, options: InfoOptions) {
    this.app = app
    this.options = options
  }

  async output(): Promise<string> {
    const sections: [string, string][] = [
      await this.devConfigsSection(),
      this.projectSettingsSection(),
      await this.appComponentsSection(),
      await this.systemInfoSection(),
    ]
    return sections.map((sectionContents: [string, string]) => formatSection(...sectionContents)).join('\n\n')
  }

  async devConfigsSection(): Promise<[string, string]> {
    const title = `Current app configuration`
    const partnersSession = await fetchPartnersSession()
    const {cachedInfo} = await getAppContext({
      partnersSession,
      directory: this.app.directory,
      reset: false,
      configName: this.options.configName,
      promptLinkingApp: false,
    })

    const postscript = outputContent`💡 To change these, run ${outputToken.packagejsonScript(
      this.app.packageManager,
      'dev',
      '--reset',
    )}`.value

    let updateUrls
    if (cachedInfo?.updateURLs === undefined) {
      updateUrls = NOT_CONFIGURED_TEXT
    } else {
      updateUrls = cachedInfo.updateURLs ? 'Yes' : 'No'
    }

    let partnersAccountInfo = ['Partners account', 'unkown']
    if (isServiceAccount(partnersSession.accountInfo)) {
      partnersAccountInfo = ['Service account', partnersSession.accountInfo.orgName]
    } else if (isUserAccount(partnersSession.accountInfo)) {
      partnersAccountInfo = ['Partners account', partnersSession.accountInfo.email]
    }

    const lines = [
      ['Configuration file', cachedInfo?.configFile || configurationFileNames.app],
      ['App name', cachedInfo?.title || NOT_CONFIGURED_TEXT],
      ['Client ID', cachedInfo?.appId || NOT_CONFIGURED_TEXT],
      ['Access scopes', getAppScopes(this.app.configuration)],
      ['Dev store', cachedInfo?.storeFqdn || NOT_CONFIGURED_TEXT],
      ['Update URLs', updateUrls],
      partnersAccountInfo,
    ]
    return [title, `${linesToColumns(lines)}\n\n${postscript}`]
  }

  projectSettingsSection(): [string, string] {
    const title = 'Your Project'
    const lines = [['Root location', this.app.directory]]
    return [title, linesToColumns(lines)]
  }

  async appComponentsSection(): Promise<[string, string]> {
    const title = 'Directory Components'

    let body = this.webComponentsSection()

    function augmentWithExtensions<TExtension extends Configurable>(
      extensions: TExtension[],
      outputFormatter: (extension: TExtension) => string,
    ) {
      const types = new Set(extensions.map((ext) => ext.type))
      types.forEach((extensionType: string) => {
        const relevantExtensions = extensions.filter((extension: TExtension) => extension.type === extensionType)
        if (relevantExtensions[0]) {
          body += `\n\n${outputContent`${outputToken.subheading(relevantExtensions[0].externalType)}`.value}`
          relevantExtensions.forEach((extension: TExtension) => {
            body += `${outputFormatter(extension)}`
          })
        }
      })
    }

    augmentWithExtensions(this.app.allExtensions, this.extensionSubSection.bind(this))

    if (this.app.errors?.isEmpty() === false) {
      body += `\n\n${outputContent`${outputToken.subheading('Extensions with errors')}`.value}`
      this.app.allExtensions.forEach((extension) => {
        body += `${this.invalidExtensionSubSection(extension)}`
      })
    }
    return [title, body]
  }

  webComponentsSection(): string {
    const errors: OutputMessage[] = []
    const subtitle = [outputContent`${outputToken.subheading('web')}`.value]
    const toplevel = ['📂 web', '']
    const sublevels: [string, string][] = []
    this.app.webs.forEach((web) => {
      if (web.configuration) {
        if (web.configuration.name) {
          const {name, roles} = web.configuration
          sublevels.push([`    📂 ${name} (${roles.join(',')})`, relativePath(this.app.directory, web.directory)])
        } else {
          web.configuration.roles.forEach((role) => {
            sublevels.push([`    📂 ${role}`, relativePath(this.app.directory, web.directory)])
          })
        }
      } else {
        sublevels.push([`  📂 ${UNKNOWN_TEXT}`, relativePath(this.app.directory, web.directory)])
      }
      if (this.app.errors) {
        const error = this.app.errors.getError(`${web.directory}/${configurationFileNames.web}`)
        if (error) errors.push(error)
      }
    })
    let errorContent = `\n${errors.map(this.formattedError).join('\n')}`
    if (errorContent.trim() === '') errorContent = ''

    return `${subtitle}\n${linesToColumns([toplevel, ...sublevels])}${errorContent}`
  }

  extensionSubSection(extension: ExtensionInstance): string {
    const config = extension.configuration
    const details = [
      [`📂 ${extension.handle}`, relativePath(this.app.directory, extension.directory)],
      ['     config file', relativePath(extension.directory, extension.configuration.path)],
    ]
    if (config && config.metafields?.length) {
      details.push(['     metafields', `${config.metafields.length}`])
    }

    return `\n${linesToColumns(details)}`
  }

  invalidExtensionSubSection(extension: ExtensionInstance): string {
    const error = this.app.errors?.getError(extension.configuration.path)
    if (!error) return ''
    const details = [
      [`📂 ${extension.handle}`, relativePath(this.app.directory, extension.directory)],
      ['     config file', relativePath(extension.directory, extension.configuration.path)],
    ]
    const formattedError = this.formattedError(error)
    return `\n${linesToColumns(details)}\n${formattedError}`
  }

  formattedError(str: OutputMessage): string {
    const [errorFirstLine, ...errorRemainingLines] = stringifyMessage(str).split('\n')
    const errorLines = [`! ${errorFirstLine}`, ...errorRemainingLines.map((line) => `  ${line}`)]
    return outputContent`${outputToken.errorText(errorLines.join('\n'))}`.value
  }

  async systemInfoSection(): Promise<[string, string]> {
    const title = 'Tooling and System'
    const {platform, arch} = platformAndArch()
    const versionUpgradeMessage = await this.versionUpgradeMessage()
    const cliVersionInfo = [this.currentCliVersion(), versionUpgradeMessage].join(' ').trim()
    const lines: string[][] = [
      ['Shopify CLI', cliVersionInfo],
      ['Package manager', this.app.packageManager],
      ['OS', `${platform}-${arch}`],
      ['Shell', process.env.SHELL || 'unknown'],
      ['Node version', process.version],
    ]
    return [title, `${linesToColumns(lines)}`]
  }

  currentCliVersion(): string {
    return this.app.nodeDependencies['@shopify/cli']!
  }

  async versionUpgradeMessage(): Promise<string> {
    const cliDependency = '@shopify/cli'
    const newestVersion = await checkForNewVersion(cliDependency, this.currentCliVersion())
    if (newestVersion) {
      return getOutputUpdateCLIReminder(this.app.packageManager, newestVersion)
    }
    return ''
  }
}
