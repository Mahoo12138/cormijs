import { Context, Service } from 'cordis'
import { defineProperty } from 'cosmokit'
import type { Arguments } from 'yargs-parser'
import { Command, type ICommandOptions, resolveConfigModes } from './command.ts'
import { type IGenerator, makeGenerator } from './generator.ts'
import { createLogger, type CormiLogger } from './logger.ts'
import { kPlugin, type Plugin, type PluginSource } from './plugin.ts'
import type { Cormi } from './service.ts'
import type { Paths } from './paths.ts'
import type { AppData } from './service.ts'
import type { IMetry, IStorage } from './telemetry.ts'
import {
  ApplyPluginsType,
  ConfigChangeType,
  EnableBy,
  type EnableByFunction,
  type Env,
  type IEvent,
  type IModify,
  type IPluginConfig,
  ServiceStage,
} from './types.ts'
import { assert, lodash, makeArray } from './utils/index.ts'

declare module 'cordis' {
  interface Context {
    /** the umi-compatible plugin API, bound to the calling plugin */
    api: PluginAPI
  }
}

type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never

/** Hooks registered by the service itself (see `servicePlugin`). */
export interface PluginAPI {
  onCheck: IEvent<null>
  onStart: IEvent<null>
  modifyAppData: IModify<AppData, null>
  modifyConfig: IModify<Record<string, any>, { paths: Paths }>
  modifyDefaultConfig: IModify<Record<string, any>, null>
  modifyPaths: IModify<Paths, null>
  modifyTelemetryStorage: IModify<IStorage, null>
}

export interface RegisterOptions {
  key: string
  fn: Function
  before?: string | string[]
  stage?: number
  name?: string
}

/**
 * umi's `PluginAPI`, provided as the cordis service `ctx.api`.
 *
 * The service is *traceable*: `this.ctx` inside every method is the context of
 * the plugin that accessed `ctx.api`, so each registration below is an effect of
 * the calling plugin's fiber — unloading or reloading that plugin rolls back its
 * hooks, commands, methods, generators and skips. Methods added with
 * `registerMethod()` are cordis accessors associated with this service
 * (`ctx.accessor('api.<name>')`), and therefore effects as well.
 */
export class PluginAPI {
  static readonly ApplyPluginsType = ApplyPluginsType
  static readonly ConfigChangeType = ConfigChangeType
  static readonly EnableBy = EnableBy
  static readonly ServiceStage = ServiceStage

  readonly ApplyPluginsType = ApplyPluginsType
  readonly ConfigChangeType = ConfigChangeType
  readonly EnableBy = EnableBy
  readonly ServiceStage = ServiceStage

  /** the calling plugin's context */
  declare ctx: Context

  private _loggers = new WeakMap<object, CormiLogger>()

  constructor(ctx: Context, private _service: Cormi) {
    this.ctx = ctx
    defineProperty(this, Service.tracker, {
      associate: 'api',
      property: 'ctx',
    })
    ctx.reflect.provide('api', this)
  }

  /** umi's `Service` instance */
  get service(): Cormi {
    return this._service
  }

  /** metadata of the calling plugin */
  get plugin(): Plugin {
    return this.ctx[kPlugin]!
  }

  get logger(): CormiLogger {
    const plugin = this.plugin
    const owner = plugin ?? this._service
    let logger = this._loggers.get(owner)
    if (!logger) {
      logger = createLogger(this._service.ctx, plugin?.key ?? 'cormi', { plugin: plugin?.id })
      this._loggers.set(owner, logger)
    }
    return logger
  }

  get telemetry(): IMetry {
    return this._service.telemetry.prefixWith(this.plugin?.key ?? 'cormi')
  }

  // properties forwarded from the service

  get appData() { return this._service.appData }
  get args(): Arguments { return this._service.args }
  get config() { return this._service.config }
  get cwd() { return this._service.cwd }
  get env(): Env { return this._service.env }
  get generators() { return this._service.generators }
  get name() { return this._service.name }
  get paths() { return this._service.paths }
  get pkg() { return this._service.pkg }
  get pkgPath() { return this._service.pkgPath }
  get userConfig() { return this._service.userConfig }

  applyPlugins: Cormi['applyPlugins'] = (opts: any) => {
    return this._service.applyPlugins(opts)
  }

  isPluginEnable(hook: Parameters<Cormi['isPluginEnable']>[0]) {
    return this._service.isPluginEnable(hook)
  }

  describe(opts: {
    key?: string
    config?: IPluginConfig
    enableBy?: EnableBy | `${EnableBy}` | EnableByFunction
  }) {
    const plugin = this.plugin
    assert(plugin, 'api.describe() should be called by a plugin')
    // a default value would enable the plugin even if the user never configured it
    if (opts.enableBy === EnableBy.config && opts.config?.default) {
      throw new Error(`[plugin: ${plugin.id}] The config.default is not allowed when enableBy is EnableBy.config.`)
    }
    this._service.describePlugin(plugin, opts)
  }

  registerCommand(opts: Omit<ICommandOptions, 'plugin'> & { alias?: string | string[] }) {
    const { alias, ...rest } = opts
    const plugin = this.plugin
    const service = this._service
    const register = (commandOpts: typeof rest) => {
      const { name, configResolveMode } = commandOpts
      assert(
        !configResolveMode || resolveConfigModes.includes(configResolveMode),
        `configResolveMode must be one of ${resolveConfigModes.join(',')}, but got ${configResolveMode}`,
      )
      return this.ctx.effect(() => {
        assert(
          !service.commands[name],
          `api.registerCommand() failed, the command ${name} is exists from ${service.commands[name]?.plugin.id}.`,
        )
        const command = new Command({ ...commandOpts, plugin })
        service.commands[name] = command
        return () => {
          if (service.commands[name] === command) delete service.commands[name]
        }
      }, `api.registerCommand(${JSON.stringify(name)})`)
    }
    const disposables = [register(rest), ...makeArray(alias).map(name => register({ ...rest, name }))]
    return () => disposables.forEach(dispose => dispose())
  }

  registerGenerator(opts: DistributiveOmit<IGenerator, 'plugin'>) {
    const { key } = opts
    const plugin = this.plugin
    const generators = this._service.generators
    return this.ctx.effect(() => {
      assert(
        !generators[key],
        `api.registerGenerator() failed, the generator ${key} is exists from ${generators[key]?.plugin.id}.`,
      )
      const generator = makeGenerator({ ...opts, plugin }) as IGenerator
      generators[key] = generator
      return () => {
        if (generators[key] === generator) delete generators[key]
      }
    }, `api.registerGenerator(${JSON.stringify(key)})`)
  }

  /** Register a hook for `applyPlugins({ key })`; returns a disposer. */
  register(opts: RegisterOptions) {
    assert(opts.key && opts.fn, `Invalid hook ${JSON.stringify(opts)}, key and fn must supplied.`)
    return (this.ctx as any).on(opts.key, opts.fn, {
      stage: opts.stage,
      before: opts.before,
      name: opts.name,
    }) as () => boolean
  }

  /**
   * Add a method to `api`. Without `fn`, the method is a shortcut of
   * `register({ key: name, fn })` — that is how `api.onStart()`, `api.modifyConfig()`, ...
   * are defined.
   */
  registerMethod(opts: { name: string; fn?: Function }) {
    const { name } = opts
    const plugin = this.plugin
    const service = this._service
    const fn = opts.fn ?? function (this: PluginAPI, hook: any) {
      return this.register({
        key: name,
        ...(lodash.isPlainObject(hook) ? hook : { fn: hook }),
      })
    }
    const ctx = this.ctx
    assert(!(name in PluginAPI.prototype) && !(name in this), `api.registerMethod() failed, ${name} is a builtin member of api.`)
    return ctx.effect(function* () {
      assert(!service.pluginMethods[name], `api.registerMethod() failed, method ${name} is already exist.`)
      service.pluginMethods[name] = { plugin, fn }
      yield () => {
        if (service.pluginMethods[name]?.fn === fn) delete service.pluginMethods[name]
      }
      yield (ctx.accessor(`api.${name}`, {
        get(receiver) {
          // `receiver` is the `ctx.api` of the plugin calling the method
          const api = receiver ?? this.api
          return (...args: any[]) => fn.apply(api, args)
        },
      }) as unknown) as () => void
    }, `api.registerMethod(${JSON.stringify(name)})`)
  }

  registerPresets(presets: PluginSource[]) {
    return this._service.registerPresets(this.ctx, presets)
  }

  registerPlugins(plugins: PluginSource[]) {
    return this._service.registerPlugins(this.ctx, plugins)
  }

  skipPlugins(keys: string[]) {
    const plugin = this.plugin
    const service = this._service
    return this.ctx.effect(() => {
      const ids: string[] = []
      for (const key of keys) {
        assert(!(plugin?.key === key), `plugin ${key} can't skip itself!`)
        const target = service.keyToPluginMap[key]
        assert(target, `key: ${key} is not be registered by any plugin. You can't skip it!`)
        if (!service.skipPluginIds.has(target.id)) {
          service.skipPluginIds.add(target.id)
          ids.push(target.id)
        }
      }
      return () => ids.forEach(id => service.skipPluginIds.delete(id))
    }, 'api.skipPlugins()')
  }
}
