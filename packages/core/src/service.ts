import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { Context, Fiber, Service } from 'cordis'
// FiberState is a const enum in cordis — access as numeric literals
const FiberStateFAILED = 3 // FAILED
import pc from 'picocolors'
import type { Arguments } from 'yargs-parser'
import { PluginAPI } from './api.ts'
import type { Command } from './command.ts'
import { Config } from './config/config.ts'
import { DEFAULT_FRAMEWORK_NAME } from './constants.ts'
import { loadEnv } from './env.ts'
import { generatePlugin } from './generatePlugin.ts'
import type { IGenerator } from './generator.ts'
import { collectHooks, type Hook, orderHooks } from './hook.ts'
import { createLogger, type CormiLogger } from './logger.ts'
import { getPaths, type Paths } from './paths.ts'
import { createPlugin, isPluginEnabled, kPlugin, Plugin, type PluginSource } from './plugin.ts'
import { servicePlugin } from './servicePlugin.ts'
import { noopStorage, Telemetry } from './telemetry.ts'
import {
  ApplyPluginsType,
  ConfigChangeType,
  EnableBy,
  type EnableByFunction,
  Env,
  type IFrameworkType,
  type IPluginConfig,
  PluginType,
  ServiceStage,
} from './types.ts'
import { assert, lodash, readJSON } from './utils/index.ts'

declare module 'cordis' {
  interface Context {
    /** umi's `Service`: stage machine, config, paths, plugins and hooks of a cormi app */
    cormi: Cormi
  }
}

const kShadow = Symbol.for('cordis.shadow')

/** Strip the def-site shadow cordis adds to `this.ctx` inside traceable service methods. */
export function unshadow(ctx: Context): Context {
  return Object.hasOwn(ctx, kShadow) ? Object.getPrototypeOf(ctx) : ctx
}

export interface AppData {
  cwd?: string
  pkg?: Record<string, any>
  pkgPath?: string
  plugins?: Record<string, Plugin>
  presets?: Plugin[]
  name?: string
  args?: Arguments
  userConfig?: Record<string, any>
  mainConfigFile?: string | null
  config?: Record<string, any>
  defaultConfig?: Record<string, any>
  framework?: IFrameworkType
  bundler?: string
  [key: string]: any
}

export namespace Cormi {
  export interface Options {
    cwd: string
    env: Env | `${Env}`
    /** extra plugins, registered after the builtin ones */
    plugins?: PluginSource[]
    /** extra presets, registered after the builtin ones */
    presets?: PluginSource[]
    /** prefix of the tmp dir, env vars (`CORMI_ENV`, `CORMI_PLUGINS`) and config files */
    frameworkName?: string
    defaultConfigFiles?: string[]
    /** run this command once the service is mounted; leave empty to call `run()` manually */
    name?: string
    args?: Partial<Arguments>
  }
}

type ApplyPluginsOptions = {
  key: string
  type?: ApplyPluginsType | `${ApplyPluginsType}`
  initialValue?: any
  args?: any
  sync?: boolean
}

/**
 * The cormi service (umi's `Service`), mounted as a cordis plugin:
 *
 * ```ts
 * const ctx = new Context()
 * await ctx.plugin(Cormi, { cwd, env: 'production', presets: [...], name: 'build' })
 * ```
 *
 * Every plugin and preset is mounted as a child fiber, so disposing (or
 * restarting) the service fiber tears down everything the app registered —
 * hooks, commands, servers, watchers — and `restart()` simply re-runs the
 * service in-process.
 */
export class Cormi {
  static readonly name = 'cormi'

  ctx: Context
  fiber: Fiber
  appData: AppData = {}
  args: Arguments = { _: [], $0: '' }
  commands: Record<string, Command> = {}
  generators: Record<string, IGenerator> = {}
  config: Record<string, any> = {}
  configSchemas: Record<string, IPluginConfig['schema']> = {}
  configDefaults: Record<string, any> = {}
  configOnChanges: Record<string, any> = {}
  cwd: string
  env: Env
  name = ''
  paths = {} as Paths
  /** registered plugins and presets by id (a preset is a plugin of another type) */
  plugins: Record<string, Plugin> = {}
  keyToPluginMap: Record<string, Plugin> = {}
  pluginMethods: Record<string, { plugin: Plugin; fn: Function }> = {}
  skipPluginIds = new Set<string>()
  stage = ServiceStage.uninitialized
  userConfig: Record<string, any> = {}
  configManager: Config | null = null
  pkg: Record<string, any> = {}
  pkgPath = ''
  telemetry = new Telemetry()
  logger: CormiLogger
  /** return value of the command run on mount */
  result: any

  private _order = 0
  private _orders = new Map<string, number>()

  constructor(ctx: Context, public opts: Cormi.Options) {
    this.ctx = ctx
    this.fiber = ctx.fiber
    this.cwd = opts.cwd
    this.env = opts.env as Env
    this.logger = createLogger(ctx, 'cormi')
    assert(existsSync(this.cwd), `Invalid cwd ${this.cwd}, it's not found.`)
    ctx.reflect.provide('cormi', this)
    // eslint-disable-next-line no-new
    new PluginAPI(ctx, this)
  }

  async* [Service.init]() {
    yield () => {
      this.telemetry.dispose()
      this.stage = ServiceStage.uninitialized
    }
    if (this.opts.name) {
      this.result = await this.run({ name: this.opts.name, args: this.opts.args })
    }
  }

  get frameworkName() {
    return this.opts.frameworkName || DEFAULT_FRAMEWORK_NAME
  }

  /** umi's `service.hooks`: hooks by key, in execution order. */
  get hooks(): Record<string, Hook[]> {
    const result: Record<string, Hook[]> = {}
    for (const key of Object.keys((this.ctx.events as any)._hooks)) {
      if (key.startsWith('internal/')) continue
      const hooks = orderHooks(collectHooks(this.ctx, key, this.fiber))
      if (hooks.length) result[key] = hooks
    }
    return result
  }

  getHooks(key: string) {
    return orderHooks(collectHooks(this.ctx, key, this.fiber))
  }

  // overload for applying an event synchronously
  applyPlugins<T = any>(opts: ApplyPluginsOptions & { sync: true }): T
  applyPlugins<T = any>(opts: ApplyPluginsOptions): Promise<T>
  applyPlugins(opts: ApplyPluginsOptions): any {
    const hooks = this.getHooks(opts.key).filter(hook => this.isPluginEnable(hook))
    let type = opts.type
    if (!type) {
      if (opts.key.startsWith('on')) {
        type = ApplyPluginsType.event
      } else if (opts.key.startsWith('modify')) {
        type = ApplyPluginsType.modify
      } else if (opts.key.startsWith('add')) {
        type = ApplyPluginsType.add
      } else {
        throw new Error(`Invalid applyPlugins arguments, type must be supplied for key ${opts.key}.`)
      }
    }
    const measure = <R>(hook: Hook, callback: () => R): R => {
      if (!hook.plugin) return callback()
      const start = Date.now()
      const record = () => (hook.plugin!.time.hooks[opts.key] ||= []).push(Date.now() - start)
      const result = callback()
      if (result instanceof Promise) return result.finally(record) as R
      record()
      return result
    }
    switch (type) {
      case ApplyPluginsType.add:
        assert(
          !('initialValue' in opts) || opts.initialValue === undefined || Array.isArray(opts.initialValue),
          `applyPlugins failed, opts.initialValue must be Array if opts.type is add.`,
        )
        return (async () => {
          let memo: any[] = opts.initialValue || []
          for (const hook of hooks) {
            const items = await measure(hook, () => hook.fn(opts.args))
            if (items !== undefined) memo = memo.concat(items)
          }
          return memo
        })()
      case ApplyPluginsType.modify:
        return (async () => {
          let memo = opts.initialValue
          for (const hook of hooks) {
            const result = await measure(hook, () => hook.fn(memo, opts.args))
            // like tapable's waterfall, `undefined` keeps the previous value
            if (result !== undefined) memo = result
          }
          return memo
        })()
      case ApplyPluginsType.event:
        if (opts.sync) {
          for (const hook of hooks) measure(hook, () => hook.fn(opts.args))
          return
        }
        return (async () => {
          for (const hook of hooks) await measure(hook, () => hook.fn(opts.args))
        })()
      default:
        throw new Error(`applyPlugins failed, type is not defined or is not matched, got ${opts.type}.`)
    }
  }

  async run(opts: { name: string; args?: Partial<Arguments> }) {
    const { name } = opts
    const args = { _: [], $0: '', ...opts.args } as Arguments
    args._ = [...(args._ || [])]
    // shift the command itself
    if (args._[0] === name) args._.shift()
    this.args = args
    this.name = name

    this.stage = ServiceStage.init
    loadEnv({ cwd: this.cwd, envFile: '.env' })
    this.pkgPath = join(this.cwd, 'package.json')
    let pkg = readJSON(this.pkgPath)
    if (!pkg && this.cwd !== process.cwd()) {
      // APP_ROOT
      pkg = readJSON(join(process.cwd(), 'package.json'))
      if (pkg) this.pkgPath = join(process.cwd(), 'package.json')
    }
    this.pkg = pkg ?? {}

    const prefix = this.frameworkName
    const specifiedEnv = process.env[`${prefix}_ENV`.toUpperCase()]
    const configManager = new Config({
      cwd: this.cwd,
      env: this.env,
      defaultConfigFiles: this.opts.defaultConfigFiles,
      specifiedEnv,
    })
    this.configManager = configManager
    this.userConfig = (await configManager.getUserConfig()).config
    // temporary paths for `modifyConfig`; plugins may update them later
    this.paths = await this.getPaths()

    // resolve initial presets and plugins
    const { plugins, presets } = this.getPluginsAndPresets()

    this.stage = ServiceStage.initPresets
    const presetPlugins: Plugin[] = []
    while (presets.length) {
      await this.initPreset({ preset: presets.shift()!, presets, plugins: presetPlugins })
    }
    plugins.unshift(...presetPlugins)
    this.stage = ServiceStage.initPlugins
    while (plugins.length) {
      await this.initPlugin({ plugin: plugins.shift()!, plugins })
    }

    const command = this.commands[name]
    if (!command) {
      this.commandGuessHelper(Object.keys(this.commands), name)
      throw new Error(`Invalid command ${pc.red(name)}, it's not registered.`)
    }
    this.collectPluginConfigs()

    this.stage = ServiceStage.resolveConfig
    const { defaultConfig } = await this.resolveConfig()
    if (this.config.outputPath) {
      this.paths.absOutputPath = isAbsolute(this.config.outputPath)
        ? this.config.outputPath
        : join(this.cwd, this.config.outputPath)
    }
    this.paths = await this.applyPlugins({ key: 'modifyPaths', initialValue: this.paths })
    const storage = await this.applyPlugins({ key: 'modifyTelemetryStorage', initialValue: noopStorage })
    this.telemetry.useStorage(storage)

    this.stage = ServiceStage.collectAppData
    this.appData = await this.applyPlugins({
      key: 'modifyAppData',
      initialValue: {
        cwd: this.cwd,
        pkg: this.pkg,
        pkgPath: this.pkgPath,
        plugins: this.plugins,
        presets: Object.values(this.plugins).filter(plugin => plugin.type === PluginType.preset),
        name,
        args,
        userConfig: this.userConfig,
        mainConfigFile: configManager.mainConfigFile,
        config: this.config,
        defaultConfig,
      } satisfies AppData,
    })

    this.stage = ServiceStage.onCheck
    await this.applyPlugins({ key: 'onCheck' })
    this.stage = ServiceStage.onStart
    await this.applyPlugins({ key: 'onStart' })

    this.stage = ServiceStage.runCommand
    const ret = await command.fn({ args })
    this.profilePlugins()
    return ret
  }

  /** Restart the whole app in-process: dispose every effect, then run the command again. */
  restart() {
    return this.fiber.restart()
  }

  async getPaths(): Promise<Paths> {
    return getPaths({ cwd: this.cwd, env: this.env, prefix: this.frameworkName })
  }

  async resolveConfig() {
    // configManager and paths are not available until the init stage
    assert(this.stage > ServiceStage.init, `Can't generate final config before init stage`)
    const resolveMode = this.commands[this.name]?.configResolveMode ?? 'strict'
    const userConfig = resolveMode === 'strict'
      ? (await this.configManager!.getConfig({ schemas: this.configSchemas })).config
      : (await this.configManager!.getUserConfig()).config
    this.userConfig = userConfig
    const config = await this.applyPlugins({
      key: 'modifyConfig',
      // plugins may mutate the memo, e.g. `memo.alias = xxx`
      initialValue: lodash.cloneDeep(userConfig),
      args: { paths: this.paths },
    })
    const defaultConfig = await this.applyPlugins({
      key: 'modifyDefaultConfig',
      initialValue: lodash.cloneDeep(this.configDefaults),
    })
    this.config = lodash.merge(defaultConfig, config)
    return { config, defaultConfig }
  }

  isPluginEnable(hook: Hook | string) {
    let plugin: Plugin | undefined
    if (typeof hook === 'string') {
      plugin = this.keyToPluginMap[hook]
      if (!plugin) return false
    } else {
      plugin = hook.plugin
      // hooks registered outside of any cormi plugin are always enabled
      if (!plugin) return true
    }
    return isPluginEnabled(plugin, this)
  }

  // plugin registration

  getPluginsAndPresets() {
    const get = (type: PluginType) => {
      const types = `${type}s` as const
      const builtin = type === PluginType.preset ? [servicePlugin] : [generatePlugin]
      const fromEnv = (process.env[`${this.frameworkName}_${types}`.toUpperCase()] || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean)
      return [
        ...builtin,
        ...(this.opts[types] || []),
        ...fromEnv,
        ...(this.userConfig[types] || []),
      ].map((source) => {
        assert(source, `Invalid ${type} ${source}.`)
        return createPlugin(source, type, this.cwd)
      })
    }
    return {
      presets: get(PluginType.preset),
      plugins: get(PluginType.plugin),
    }
  }

  async initPreset(opts: { preset: Plugin; presets: Plugin[]; plugins: Plugin[] }) {
    const { presets, plugins } = await this.initPlugin({
      plugin: opts.preset,
      presets: opts.presets,
      plugins: opts.plugins,
    })
    opts.presets.unshift(...presets)
    opts.plugins.push(...plugins)
  }

  async initPlugin(opts: { plugin: Plugin; presets?: Plugin[]; plugins: Plugin[] }) {
    const { plugin } = opts
    plugin.queue = { presets: opts.presets, plugins: opts.plugins }
    try {
      await this.mountPlugin(plugin)
    } finally {
      plugin.queue = undefined
    }
    return this.getReturnedPlugins(plugin)
  }

  /** `{ presets, plugins }` returned by an umi-style preset function. */
  private getReturnedPlugins(plugin: Plugin) {
    const ret = plugin.ret
    if (plugin.type === PluginType.plugin) {
      assert(!ret, `plugin should return nothing`)
    }
    const parent = plugin.fiber?.ctx
    const create = (type: PluginType) => (source: PluginSource) => {
      const target = createPlugin(source, type, this.cwd)
      target.parent = parent
      return target
    }
    return {
      presets: (ret?.presets ?? []).map(create(PluginType.preset)) as Plugin[],
      plugins: (ret?.plugins ?? []).map(create(PluginType.plugin)) as Plugin[],
    }
  }

  /**
   * Mount a plugin as a cordis fiber under `plugin.parent` (the plugin that
   * registered it, or the service). The registration itself is an effect of the
   * parent, so the plugin is unregistered when its parent goes away.
   */
  async mountPlugin(plugin: Plugin) {
    const start = Date.now()
    const target = await plugin.resolve()
    const parent = plugin.parent ?? this.ctx
    parent.effect(() => {
      assert(
        !this.plugins[plugin.id],
        `${plugin.type} ${plugin.id} is already registered by ${this.plugins[plugin.id]?.path || this.plugins[plugin.id]?.id}, ${plugin.type} from ${plugin.path || plugin.id} register failed.`,
      )
      this.plugins[plugin.id] = plugin
      plugin.order = this.getOrder(plugin.id)
      return () => {
        if (this.plugins[plugin.id] === plugin) delete this.plugins[plugin.id]
        if (this.keyToPluginMap[plugin.key] === plugin) delete this.keyToPluginMap[plugin.key]
      }
    }, `cormi.plugin(${JSON.stringify(plugin.id)})`)
    if (this.shouldMount(plugin)) {
      const fiber = parent.extend({ [kPlugin]: plugin }).plugin(target, this.getPluginConfig(plugin))
      plugin.fiber = fiber.ctx.fiber
      await fiber
    }
    plugin.time.register = Date.now() - start
    // the key is final once `describe()` has run
    this.claimKey(plugin)
  }

  /** A cordis-native plugin that is disabled by config is not mounted at all. */
  shouldMount(plugin: Plugin) {
    if (!plugin.native) return true
    if (this.userConfig[plugin.key] === false) return false
    if (plugin.enableBy === EnableBy.config) return plugin.key in this.userConfig
    if (typeof plugin.enableBy === 'function') {
      return plugin.enableBy({ userConfig: this.userConfig, config: this.config, env: this.env })
    }
    return true
  }

  getPluginConfig(plugin: Plugin) {
    if (!plugin.native) return
    const value = this.userConfig[plugin.key]
    return value === undefined ? lodash.cloneDeep(plugin.config.default) : value
  }

  /**
   * Re-apply a cordis-native plugin after its config changed: mount it if it
   * became enabled, dispose it if it became disabled, otherwise `fiber.update()`
   * reloads just that plugin with the new config.
   */
  async reloadPlugin(plugin: Plugin) {
    const fiber = plugin.fiber
    const active = fiber && fiber.uid !== null && fiber.state !== FiberStateFAILED
    if (!this.shouldMount(plugin)) {
      if (active) await fiber.dispose()
      plugin.fiber = undefined
      return
    }
    if (!active) {
      const created = (plugin.parent ?? this.ctx).extend({ [kPlugin]: plugin }).plugin(await plugin.resolve(), this.getPluginConfig(plugin))
      plugin.fiber = created.ctx.fiber
      await created
    } else if (fiber.state === FiberStateFAILED || !lodash.isEqual(fiber.config, this.getPluginConfig(plugin))) {
      await fiber.update(this.getPluginConfig(plugin))
    }
  }

  /**
   * Hot-reload a cordis-native plugin after its source changed: dispose its
   * fiber (rolling back every effect), import the module again and mount it
   * at the same place. umi-style plugins need `restart()` instead, since the
   * stages their hooks took part in have already run.
   */
  async reloadPluginModule(plugin: Plugin) {
    assert(plugin.native, `only cordis-native plugins can be hot reloaded, ${plugin.id} is not`)
    plugin.invalidate()
    const target = await plugin.resolve()
    if (plugin.fiber && plugin.fiber.uid !== null) await plugin.fiber.dispose()
    plugin.fiber = undefined
    if (!this.shouldMount(plugin)) return
    const created = (plugin.parent ?? this.ctx).extend({ [kPlugin]: plugin }).plugin(target, this.getPluginConfig(plugin))
    plugin.fiber = created.ctx.fiber
    await created
  }

  private claimKey(plugin: Plugin) {
    for (const [key, value] of Object.entries(this.keyToPluginMap)) {
      if (value === plugin && key !== plugin.key) delete this.keyToPluginMap[key]
    }
    const existing = this.keyToPluginMap[plugin.key]
    assert(
      !existing || existing === plugin,
      `key ${plugin.key} is already registered by ${existing?.path || existing?.id}, ${plugin.type} from ${plugin.path || plugin.id} register failed.`,
    )
    this.keyToPluginMap[plugin.key] = plugin
  }

  describePlugin(plugin: Plugin, opts: {
    key?: string
    config?: IPluginConfig
    enableBy?: EnableBy | `${EnableBy}` | EnableByFunction
  }) {
    plugin.merge(opts)
    // after the init stages, a reloaded plugin re-describes itself
    if (this.stage > ServiceStage.initPlugins) {
      this.claimKey(plugin)
      this.collectPluginConfig(plugin)
    }
  }

  registerPresets(caller: Context, sources: PluginSource[]) {
    const plugin = caller[kPlugin]
    const queue = plugin?.queue
    const parent = unshadow(caller)
    const presets = sources.map((source) => {
      const preset = createPlugin(source, PluginType.preset, this.cwd)
      preset.parent = parent
      return preset
    })
    if (queue) {
      assert(
        this.stage === ServiceStage.initPresets && queue.presets,
        `api.registerPresets() failed, it should only used in presets.`,
      )
      queue.presets!.splice(0, 0, ...presets)
      return
    }
    // a preset reloaded after startup mounts its presets right away
    return this.mountLater(presets)
  }

  registerPlugins(caller: Context, sources: PluginSource[]) {
    const plugin = caller[kPlugin]
    const queue = plugin?.queue
    const parent = unshadow(caller)
    const plugins = sources.map((source) => {
      const target = createPlugin(source, PluginType.plugin, this.cwd)
      target.parent = parent
      return target
    })
    if (queue) {
      assert(
        this.stage === ServiceStage.initPresets || this.stage === ServiceStage.initPlugins,
        `api.registerPlugins() failed, it should only be used in registering stage.`,
      )
      if (this.stage === ServiceStage.initPresets) {
        queue.plugins.push(...plugins)
      } else {
        queue.plugins.splice(0, 0, ...plugins)
      }
      return
    }
    return this.mountLater(plugins)
  }

  private async mountLater(plugins: Plugin[]) {
    for (const plugin of plugins) {
      await this.mountPlugin(plugin)
      this.collectPluginConfig(plugin)
      const { presets, plugins: children } = this.getReturnedPlugins(plugin)
      if (presets.length || children.length) await this.mountLater([...presets, ...children])
    }
  }

  private getOrder(id: string) {
    let order = this._orders.get(id)
    if (order === undefined) {
      order = ++this._order
      this._orders.set(id, order)
    }
    return order
  }

  collectPluginConfigs() {
    for (const plugin of Object.values(this.plugins)) {
      this.collectPluginConfig(plugin)
    }
  }

  private collectPluginConfig(plugin: Plugin) {
    const { config, key } = plugin
    if (config.schema) this.configSchemas[key] = config.schema
    if (config.default !== undefined) this.configDefaults[key] = config.default
    this.configOnChanges[key] = config.onChange || ConfigChangeType.reload
  }

  commandGuessHelper(commands: string[], currentCmd: string) {
    const altCmds = commands.filter((cmd) => {
      return levenshtein(currentCmd, cmd) < currentCmd.length * 0.6 && currentCmd !== cmd
    })
    if (!altCmds.length) return
    const printHelper = altCmds.slice(0, 3).map(cmd => ` - ${pc.green(cmd)}`).join('\n')
    this.logger.info(`${pc.cyan(altCmds.length === 1 ? 'Did you mean this command ?' : 'Did you mean one of these commands ?')}\n${printHelper}`)
  }

  profilePlugins() {
    if (!this.args.profilePlugins) return
    const add = (nums: number[]) => nums.reduce((a, b) => a + b, 0)
    const totalTime = (plugin: Plugin) => (plugin.time.register || 0)
      + Object.values(plugin.time.hooks).reduce((a, b) => a + add(b), 0)
    Object.keys(this.plugins)
      .map((id) => {
        const plugin = this.plugins[id]
        return { id, total: totalTime(plugin), register: plugin.time.register || 0, hooks: plugin.time.hooks }
      })
      .filter(time => time.total > (this.args.profilePluginsLimit ?? 10))
      .sort((a, b) => b.total - a.total)
      .forEach((time) => {
        console.log(pc.green('plugin'), time.id, time.total)
        if (this.args.profilePluginsVerbose) {
          console.log('      ', pc.green('register'), time.register)
          const hooks = Object.fromEntries(Object.entries(time.hooks).sort((a, b) => add(b[1]) - add(a[1])))
          console.log('      ', pc.green('hooks'), JSON.stringify(hooks))
        }
      })
  }
}

function levenshtein(a: string, b: string) {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0]
    dp[0] = i
    for (let j = 1; j <= b.length; j++) {
      const temp = dp[j]
      dp[j] = a[i - 1] === b[j - 1] ? prev : Math.min(prev, dp[j], dp[j - 1]) + 1
      prev = temp
    }
  }
  return dp[b.length]
}
