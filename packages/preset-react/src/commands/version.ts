import type { IApi } from '../types.ts'

export default (api: IApi) => {
  api.registerCommand({
    name: 'version',
    alias: 'v',
    description: 'show cormi version',
    configResolveMode: 'loose',
    fn({ args }) {
      const version = api.appData.cormi.version
      if (!args.quiet) console.log(`cormi@${version}`)
      return version
    },
  })
}
