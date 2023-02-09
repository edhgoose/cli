import AppGenerateExtension from '../generate/extension.js'
import {renderWarning} from '@shopify/cli-kit/node/ui'

class AppScaffoldExtension extends AppGenerateExtension {
  static description = 'Scaffold an extension.'
  static hidden = true
  public async run(): Promise<void> {
    renderWarning({
      headline: [
        'The command',
        {command: 'scaffold'},
        'has been deprecated in favor of',
        {command: 'generate'},
        'and will be eventually deleted.',
        'You might need to update the',
        {command: 'scaffold'},
        "script in the project's package.json.",
      ],
    })
    await super.run()
  }
}

export default AppScaffoldExtension
