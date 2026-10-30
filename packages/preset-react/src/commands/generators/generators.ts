import { existsSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { GeneratorType, lodash, prompts } from '@cormi/core'
import pc from 'picocolors'
import { TEMPLATES_DIR } from '../../constants.ts'
import type { IApi } from '../../types.ts'

const GENERATE_DIR = join(TEMPLATES_DIR, 'generate')

function randomColor() {
  return `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`
}

async function askName(message: string, initial: string) {
  const { name } = await prompts({ type: 'text', name: 'name', message, initial }, { onCancel: () => process.exit(1) })
  return name as string
}

function toComponentName(name: string) {
  const camel = lodash.camelCase(name)
  return camel.charAt(0).toUpperCase() + camel.slice(1)
}

/** Builtin generators: page, component, api, mock, tsconfig, prettier, editorconfig. */
export default (api: IApi) => {
  api.describe({ key: 'generator:builtin' })

  api.registerGenerator({
    key: 'page',
    name: 'Create Pages',
    description: 'Create a page by page name',
    type: GeneratorType.generate,
    async fn({ args, generateFile }) {
      const names = (args._.slice(1) as string[]).length ? args._.slice(1) as string[] : [await askName('What is the name of page?', 'unTitledPage')]
      for (const path of names) {
        // `foo/bar` -> pages/foo/bar.tsx, `--dir` -> pages/foo/bar/index.tsx
        const name = args.dir ? 'index' : basename(path)
        const dir = args.dir ? join(api.paths.absPagesPath, path) : join(api.paths.absPagesPath, dirname(path))
        await generateFile({
          path: join(GENERATE_DIR, 'page'),
          target: dir,
          baseDir: api.cwd,
          data: { name, color: randomColor() },
        })
        // rename `index.*` to `<name>.*` when not in dir mode
        if (!args.dir) {
          for (const [from, to] of [['index.tsx', `${name}.tsx`], ['index.module.css', `${name}.module.css`]]) {
            const source = join(dir, from)
            if (from === to || !existsSync(source)) continue
            renameSync(source, join(dir, to))
          }
        }
      }
    },
  })

  api.registerGenerator({
    key: 'component',
    name: 'Generate Component',
    description: 'Generate component boilerplate code',
    type: GeneratorType.generate,
    async fn({ args, generateFile }) {
      const names = (args._.slice(1) as string[]).length ? args._.slice(1) as string[] : [await askName('Please input your component Name', 'Foo')]
      for (const path of names) {
        const compName = toComponentName(basename(path))
        const target = join(api.paths.absSrcPath, 'components', dirname(path), compName)
        await generateFile({
          path: join(GENERATE_DIR, 'component'),
          target,
          baseDir: api.cwd,
          data: { compName },
        })
        const source = join(target, 'component.tsx')
        if (existsSync(source)) renameSync(source, join(target, `${compName}.tsx`))
      }
    },
  })

  api.registerGenerator({
    key: 'api',
    name: 'Generate Api',
    description: 'Generate api route boilerplate code',
    type: GeneratorType.generate,
    async fn({ args, generateFile }) {
      const names = (args._.slice(1) as string[]).length ? args._.slice(1) as string[] : [await askName('please input your api name:', 'foo')]
      for (const path of names) {
        const target = join(api.paths.absApiRoutesPath, `${path}.ts`)
        if (existsSync(target)) throw new Error(`api route ${relative(api.cwd, target)} already exists.`)
        await generateFile({
          path: join(GENERATE_DIR, 'api.ts.tpl'),
          target,
          baseDir: api.cwd,
          data: { name: JSON.stringify(basename(path).replace(/^\[|\]$/g, '')).slice(1, -1) },
        })
      }
    },
  })

  api.registerGenerator({
    key: 'mock',
    name: 'Generate mock',
    description: 'Generate mock boilerplate code',
    type: GeneratorType.generate,
    async fn({ args, generateFile }) {
      const names = (args._.slice(1) as string[]).length ? args._.slice(1) as string[] : [await askName('please input your mock file name', 'mockName')]
      for (const path of names) {
        const target = join(api.cwd, 'mock', `${path}.ts`)
        if (existsSync(target)) throw new Error(`mock file ${relative(api.cwd, target)} already exists.`)
        await generateFile({
          path: join(GENERATE_DIR, 'mock.ts.tpl'),
          target,
          baseDir: api.cwd,
          data: { mockName: basename(path) },
        })
      }
    },
  })

  api.registerGenerator({
    key: 'tsconfig',
    name: 'Enable Typescript',
    description: 'Setup tsconfig.json',
    type: GeneratorType.enable,
    checkEnable: () => !existsSync(join(api.cwd, 'tsconfig.json')),
    disabledDescription: 'tsconfig.json has already enabled. You can remove tsconfig.json then run this again to re-setup.',
    fn({ updatePackageJSON, installDeps }) {
      writeFileSync(join(api.cwd, 'tsconfig.json'), `${JSON.stringify({
        extends: `./${relative(api.cwd, join(api.paths.absTmpPath, 'tsconfig.json'))}`,
      }, null, 2)}\n`)
      updatePackageJSON({ opts: { scripts: { postinstall: 'cormi setup' } }, cwd: api.cwd })
      if (!api.appData.typescript?.tsVersion) {
        installDeps({ opts: { devDependencies: ['typescript', '@types/react', '@types/react-dom'] }, cwd: api.cwd })
      }
      api.logger.info(`${pc.green('Write:')} tsconfig.json`)
    },
  })

  api.registerGenerator({
    key: 'prettier',
    name: 'Enable Prettier',
    description: 'Setup Prettier configurations',
    type: GeneratorType.enable,
    checkEnable: () => !existsSync(join(api.cwd, '.prettierrc')),
    disabledDescription: 'prettier has been enabled; You can remove `.prettierrc` to run this again to re-setup.',
    fn({ updatePackageJSON, installDeps }) {
      writeFileSync(join(api.cwd, '.prettierrc'), `${JSON.stringify({ singleQuote: true, trailingComma: 'all', printWidth: 80 }, null, 2)}\n`)
      writeFileSync(join(api.cwd, '.prettierignore'), ['node_modules', '.cormi', '.cormi-production', 'dist', ''].join('\n'))
      updatePackageJSON({ opts: { scripts: { format: 'prettier --cache --write .' } }, cwd: api.cwd })
      installDeps({ opts: { devDependencies: ['prettier'] }, cwd: api.cwd })
      api.logger.info(`${pc.green('Write:')} .prettierrc, .prettierignore`)
    },
  })

  api.registerGenerator({
    key: 'editorconfig',
    name: 'Create .editorconfig',
    description: 'Setup editorconfig config',
    type: GeneratorType.enable,
    checkEnable: () => !existsSync(join(api.cwd, '.editorconfig')),
    disabledDescription: 'The .editorconfig file already exists.',
    fn() {
      writeFileSync(join(api.cwd, '.editorconfig'), [
        'root = true',
        '',
        '[*]',
        'indent_style = space',
        'indent_size = 2',
        'end_of_line = lf',
        'charset = utf-8',
        'trim_trailing_whitespace = true',
        'insert_final_newline = true',
        '',
        '[*.md]',
        'trim_trailing_whitespace = false',
        '',
      ].join('\n'))
      api.logger.info(`${pc.green('Write:')} .editorconfig`)
    },
  })
}
