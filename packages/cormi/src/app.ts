import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { ConsoleExporter, Cormi, Env, type PluginSource } from '@cormi/core'
import presetReact from '@cormi/preset-react'
import { Context } from 'cordis'
import type { Arguments } from 'yargs-parser'
import { FRAMEWORK_NAME } from './constants.ts'

export interface CreateAppOptions {
  cwd?: string
  env?: Env | `${Env}`
  /** command to run, e.g. `dev`, `build` */
  name: string
  args?: Partial<Arguments>
  presets?: PluginSource[]
  plugins?: PluginSource[]
  /** reuse an existing cordis context (e.g. to embed cormi in a larger cordis app) */
  ctx?: Context
  /** print logs to the console (default true) */
  console?: boolean | ConsoleExporter.Config
}

/** The working directory of the app: `APP_ROOT` or `process.cwd()`. */
export function getCwd() {
  const appRoot = process.env.APP_ROOT
  if (!appRoot) return process.cwd()
  return isAbsolute(appRoot) ? appRoot : join(process.cwd(), appRoot)
}

/**
 * Create a cordis context running a cormi app:
 *
 * ```ts
 * const { ctx, fiber } = await createApp({ name: 'build' })
 * await ctx.cormi.result
 * ```
 *
 * The service is a cordis plugin, so the whole app (plugins, servers,
 * watchers) is torn down by `fiber.dispose()` and restarted by `fiber.restart()`.
 */
export async function createApp(opts: CreateAppOptions) {
  const cwd = opts.cwd ?? getCwd()
  const ctx = opts.ctx ?? new Context()
  if (opts.console !== false) {
    // eslint-disable-next-line no-new
    new ConsoleExporter(ctx, typeof opts.console === 'object' ? opts.console : {})
  }
  const env = (opts.env ?? process.env.NODE_ENV ?? Env.development) as Env
  const localPlugins = ['plugin.ts', 'plugin.js', 'plugin.mjs']
    .map(file => join(cwd, file))
    .filter(file => existsSync(file))
  const fiber = ctx.plugin(Cormi, {
    cwd,
    env,
    frameworkName: FRAMEWORK_NAME,
    presets: [presetReact, ...(opts.presets ?? [])],
    plugins: [...localPlugins, ...(opts.plugins ?? [])],
    name: opts.name,
    args: opts.args,
  })
  await fiber
  return { ctx, fiber, cormi: ctx.get('cormi') as Cormi }
}
