import type { PluginAPI } from './api.ts'
import { type IGenerator, GeneratorType } from './generator.ts'
import { generateFile, installDeps, prompts, updatePackageJSON } from './utils/index.ts'

/** Builtin plugin: `cormi generate [type]` (alias `g`) runs registered generators. */
export function generatePlugin(api: PluginAPI) {
  api.registerCommand({
    name: 'generate',
    alias: 'g',
    details: `
cormi generate
cormi g page foo
`,
    description: 'generate code snippets quickly',
    configResolveMode: 'loose',
    async fn({ args }) {
      const [type] = args._
      const runGenerator = async (generator: IGenerator) => {
        await generator?.fn({
          args,
          generateFile,
          installDeps,
          updatePackageJSON,
        })
      }

      if (type) {
        const generator = api.service.generators[type]
        if (!generator) {
          throw new Error(`Generator ${type} not found.`)
        }
        if (generator.type === GeneratorType.enable) {
          const enable = await generator.checkEnable?.({ args })
          if (!enable) {
            const { disabledDescription } = generator
            api.logger.warn(typeof disabledDescription === 'function' ? disabledDescription() : disabledDescription)
            return
          }
        }
        await runGenerator(generator)
        return
      }

      const choices: { title: string; value: string }[] = []
      for (const generator of Object.values(api.service.generators)) {
        if (generator.type === GeneratorType.enable && !await generator.checkEnable?.({ args })) continue
        choices.push({ title: `${generator.name} -- ${generator.description}`, value: generator.key })
      }
      if (!choices.length) {
        api.logger.warn('No generator is available.')
        return
      }
      const { gType } = await prompts({
        type: 'select',
        name: 'gType',
        message: 'Pick generator type',
        choices,
      })
      if (gType) await runGenerator(api.service.generators[gType])
    },
  })
}

generatePlugin.id = '@cormi/core/generatePlugin'
generatePlugin.key = 'generatePlugin'
