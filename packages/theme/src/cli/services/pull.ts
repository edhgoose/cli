import {downloadTheme} from '../utilities/theme-downloader.js'
import {hasRequiredThemeDirectories, mountThemeFileSystem} from '../utilities/theme-fs.js'
import {currentDirectoryConfirmed, themeComponent} from '../utilities/theme-ui.js'
import {rejectGeneratedStaticAssets} from '../utilities/asset-checksum.js'
import {showEmbeddedCLIWarning} from '../utilities/embedded-cli-warning.js'
import {ensureThemeStore} from '../utilities/theme-store.js'
import {DevelopmentThemeManager} from '../utilities/development-theme-manager.js'
import {findOrSelectTheme} from '../utilities/theme-selector.js'
import {FlagValues, passThroughFlags} from '../utilities/theme-command.js'
import Pull from '../commands/theme/pull.js'
import {Theme} from '@shopify/cli-kit/node/themes/types'
import {AdminSession, ensureAuthenticatedThemes} from '@shopify/cli-kit/node/session'
import {fetchChecksums} from '@shopify/cli-kit/node/themes/api'
import {renderSuccess} from '@shopify/cli-kit/node/ui'
import {glob} from '@shopify/cli-kit/node/fs'
import {useEmbeddedThemeCLI} from '@shopify/cli-kit/node/context/local'
import {execCLI2} from '@shopify/cli-kit/node/ruby'

interface PullOptions {
  path: string
  nodelete: boolean
  force: boolean
  only?: string[]
  ignore?: string[]
}

export interface PullFlags {
  path: string
  password?: string
  environment?: string
  store?: string
  theme?: string
  development: boolean
  live: boolean
  nodelete: boolean
  only?: string[]
  ignore?: string[]
  force: boolean
  legacy: boolean
}

export async function pull(flags: PullFlags) {
  showEmbeddedCLIWarning()

  const store = ensureThemeStore({store: flags.store})
  const adminSession = await ensureAuthenticatedThemes(store, flags.password)

  const developmentThemeManager = new DevelopmentThemeManager(adminSession)
  const developmentTheme = await (flags.development ? developmentThemeManager.find() : developmentThemeManager.fetch())

  if (!flags.legacy) {
    const {path, nodelete, live, development, only, ignore, force} = flags

    const theme = await findOrSelectTheme(adminSession, {
      header: 'Select a theme to open',
      filter: {
        live,
        theme: development ? `${developmentTheme?.id}` : flags.theme,
      },
    })

    await executePull(theme, adminSession, {path, nodelete, only, ignore, force})
    return
  }

  const flagsForCli2 = flags as typeof flags & FlagValues

  if (developmentTheme) {
    if (flagsForCli2.development) {
      flagsForCli2.theme = `${developmentTheme.id}`
      flagsForCli2.development = false
    }
    if (useEmbeddedThemeCLI()) {
      flagsForCli2['development-theme-id'] = developmentTheme.id
    }
  }

  const flagsToPass = passThroughFlags(flagsForCli2, {allowedFlags: Pull.cli2Flags})
  const command = ['theme', 'pull', flagsForCli2.path, ...flagsToPass]

  await execCLI2(command, {store, adminToken: adminSession.token})
}

async function executePull(theme: Theme, session: AdminSession, options: PullOptions) {
  const path = options.path
  const force = options.force

  /**
   * If users are not forcing the `pull` command, the directory is not empty,
   * and the directory doesn't look like a theme directory, we ask for
   * confirmation, because the `pull` command has the destructive behavior of
   * removing local assets that are not present remotely.
   */
  if (
    !(await isEmptyDir(path)) &&
    !(await hasRequiredThemeDirectories(path)) &&
    !(await currentDirectoryConfirmed(force))
  ) {
    return
  }

  const themeFileSystem = mountThemeFileSystem(path, {filters: options})
  const [remoteChecksums] = await Promise.all([fetchChecksums(theme.id, session), themeFileSystem.ready()])
  const themeChecksums = rejectGeneratedStaticAssets(remoteChecksums)

  const store = session.storeFqdn
  const themeId = theme.id

  await downloadTheme(theme, session, themeChecksums, themeFileSystem, options)

  renderSuccess({
    body: ['The theme', ...themeComponent(theme), 'has been pulled.'],
    nextSteps: [
      [
        {
          link: {
            label: 'View your theme',
            url: `https://${store}/?preview_theme_id=${themeId}`,
          },
        },
      ],
      [
        {
          link: {
            label: 'Customize your theme at the theme editor',
            url: `https://${store}/admin/themes/${themeId}/editor`,
          },
        },
      ],
    ],
  })
}

export async function isEmptyDir(path: string) {
  const entries = await glob('*', {
    cwd: path,
    deep: 1,
    onlyFiles: false,
  })

  return entries.length === 0
}
