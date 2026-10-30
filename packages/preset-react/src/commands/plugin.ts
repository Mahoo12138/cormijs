import pc from 'picocolors'
import type { IApi } from '../types.ts'

export default (api: IApi) => {
  api.describe({
    key: 'command:plugin',
  })

  api.registerCommand({
    name: 'plugin',
    description: 'inspect cormi plugins',
    details: `
cormi plugin list
cormi plugin list --key
`,
    configResolveMode: 'loose',
    fn({ args }) {
      const command = args._[0]
      if (command !== 'list') {
        throw new Error(`Unsupported sub command ${command ?? '(none)'} for cormi plugin, did you mean: cormi plugin list`)
      }
      const list = Object.values(api.service.plugins).sort((a, b) => a.order - b.order).map((plugin) => {
        const tags: string[] = []
        if (plugin.type === 'preset') tags.push(pc.cyan('preset'))
        if (plugin.native) tags.push(pc.magenta('cordis'))
        if (plugin.path && !plugin.path.includes('/node_modules/') && plugin.dependencies.length) tags.push(pc.green('local'))
        if (!api.isPluginEnable(plugin.key)) tags.push(pc.gray('disabled'))
        const key = args.key ? ` ${pc.gray(`(${plugin.key})`)}` : ''
        return `- ${plugin.id}${key}${tags.length ? ` ${tags.join(' ')}` : ''}`
      })
      console.log(list.join('\n'))
      return Object.keys(api.service.plugins)
    },
  })
}
