import { join } from 'node:path'
import type { Env, IBabelPresetOpts, IBundlerOpts, IUniBundlerInstance } from '@cormi/core'
import type { IApi } from '../types.ts'

/**
 * Resolve aliases pointing at other aliases (`cormi` -> `@@/exports` -> `<tmp>/exports`),
 * since Vite does not re-apply aliases to an aliased id.
 */
export function resolveAliases(alias: Record<string, string>) {
  const keys = Object.keys(alias).sort((a, b) => b.length - a.length)
  const resolveValue = (value: string, depth = 0): string => {
    if (depth > 10) return value
    for (const key of keys) {
      const find = key.endsWith('$') ? key.slice(0, -1) : key
      if (value === find || (!key.endsWith('$') && value.startsWith(find + '/'))) {
        if (alias[key] === value) return value
        return resolveValue(alias[key] + value.slice(find.length), depth + 1)
      }
    }
    return value
  }
  return Object.fromEntries(Object.entries(alias).map(([key, value]) => [key, resolveValue(value)]))
}

/** `process.env.NODE_ENV`, `process.env.CORMI_APP_*` and `config.define`, as code. */
export function getDefines(api: IApi, env: Env | `${Env}`) {
  const define: Record<string, string> = {
    'process.env.NODE_ENV': JSON.stringify(env),
  }
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('CORMI_APP_')) define[`process.env.${key}`] = JSON.stringify(process.env[key])
  }
  for (const [key, value] of Object.entries(api.config.define ?? {})) {
    define[key] = JSON.stringify(value)
  }
  return define
}

export async function getBabelOpts(api: IApi, env: Env | `${Env}`) {
  const presetOpts: IBabelPresetOpts = await api.applyPlugins({
    key: 'modifyBabelPresetOpts',
    initialValue: {
      presetEnv: {},
      presetReact: {
        runtime: 'automatic',
        development: env === 'development',
      },
      presetTypeScript: {},
      pluginTransformRuntime: {},
    },
  })
  return {
    presetOpts,
    beforeBabelPlugins: await api.applyPlugins({ key: 'addBeforeBabelPlugins', initialValue: [] }),
    beforeBabelPresets: await api.applyPlugins({ key: 'addBeforeBabelPresets', initialValue: [] }),
    extraBabelPlugins: await api.applyPlugins({ key: 'addExtraBabelPlugins', initialValue: api.config.extraBabelPlugins ?? [] }),
    extraBabelPresets: await api.applyPlugins({ key: 'addExtraBabelPresets', initialValue: api.config.extraBabelPresets ?? [] }),
  }
}

/** Options handed to the bundler, after `modifyEntry` and `modifyUniBundlerOpts`. */
export async function getBundlerOpts(api: IApi, opts: Partial<IBundlerOpts> & { env: Env | `${Env}` }) {
  const entry: Record<string, string> = await api.applyPlugins({
    key: 'modifyEntry',
    initialValue: { cormi: join(api.paths.absTmpPath, 'cormi.ts') },
  })
  const { env } = opts
  let bundlerOpts: IBundlerOpts = {
    cwd: api.cwd,
    rootDir: process.cwd(),
    config: api.config,
    pkg: api.pkg,
    paths: api.paths,
    entry,
    serverEntry: api.appData.serverEntry,
    alias: resolveAliases(api.config.alias ?? {}),
    define: getDefines(api, env),
    babel: await getBabelOpts(api, env),
    react: { runtime: 'automatic' },
    modifyViteConfig: (memo, args) => api.applyPlugins({ key: 'modifyViteConfig', initialValue: memo, args }),
    chainWebpack: async (memo, args) => {
      await api.applyPlugins({ key: 'chainWebpack', type: api.ApplyPluginsType.modify, initialValue: memo, args })
    },
    modifyWebpackConfig: (memo, args) => api.applyPlugins({ key: 'modifyWebpackConfig', initialValue: memo, args }),
    async checkCode(args) {
      const { CodeFrameError } = await import('@cormi/bundler-vite')
      await api.applyPlugins({ key: 'onCheckCode', args: { ...args, CodeFrameError } })
    },
    ...opts,
  }
  bundlerOpts = await api.applyPlugins({
    key: 'modifyUniBundlerOpts',
    initialValue: bundlerOpts,
    args: { bundler: api.appData.bundler },
  })
  return bundlerOpts
}

export async function getBundler(api: IApi, opts: IBundlerOpts): Promise<IUniBundlerInstance> {
  await api.applyPlugins({
    key: 'onBeforeCompiler',
    args: { compiler: api.appData.bundler, opts },
  })
  const bundler = await api.applyPlugins({
    key: 'modifyUniBundler',
    args: { bundler: api.appData.bundler, opts },
  })
  if (!bundler) throw new Error(`No bundler is registered for "${api.appData.bundler}".`)
  return bundler
}
