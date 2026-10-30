import { rmSync } from 'node:fs'
import type { IApi } from '../types.ts'

export default (api: IApi) => {
  api.registerCommand({
    name: 'setup',
    description: 'setup project (generate the tmp files)',
    async fn() {
      rmSync(api.paths.absTmpPath, { recursive: true, force: true })
      await api.applyPlugins({
        key: 'onGenerateFiles',
        args: { files: null, isFirstTime: true },
      })
      api.logger.ready(`Generated ${api.paths.absTmpPath}`)
    },
  })
}
