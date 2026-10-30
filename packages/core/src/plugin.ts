import { basename, dirname, extname, join, relative } from 'node:path'
import type { Context, Fiber } from 'cordis'
import { EnableBy, type EnableByFunction, type Env, type IPluginConfig, PluginType } from './types.ts'
import {
  assert,
  findPackageJSON,
  isClass,
  lodash,
  loadModule,
  nameToKey,
  readJSON,
  tryResolveModule,
  unwrapDefault,
  winPath,
} from './utils/index.ts'

/** The cormi plugin a context belongs to; inherited by every context derived from it. */
export const kPlugin = Symbol.for('cormi.plugin')

declare module 'cordis' {
  interface Context {
    [kPlugin]?: Plugin
  }
}

const RE = {
  plugin: /^(@cormi\/|cormi-)plugin-/,
  preset: /^(@cormi\/|cormi-)preset-/,
}

/**
 * What can be registered as a plugin / preset:
 *
 * - a path or package name (umi: only paths are allowed)
 * - an umi-style function `(api) => void | { presets, plugins }`
 * - a cordis plugin: an object with `apply(ctx, config)`, a class, or a
 *   function carrying cordis statics (`inject`, `Config`, `provide`)
 * - a placeholder object `{ id, key }` that only declares a config key
 */
export type PluginSource = string | Function | Record<string, any>

/** Static metadata a cordis-native plugin may declare next to `apply`. */
export interface NativePluginMeta {
  /** config key; defaults to the key derived from the file / package name */
  key?: string
  /** `EnableBy.config`: the plugin is only mounted while its key is configured */
  enableBy?: `${EnableBy}` | EnableBy | EnableByFunction
  /** how a config change applies, defaults to `reloadPlugin` (reload this plugin's fiber only) */
  onChange?: IPluginConfig['onChange']
  /** default value of the config key */
  defaultConfig?: any
}

export interface PluginOptions {
  type: PluginType | `${PluginType}`
  cwd: string
  /** absolute path of the module (when registered by path) */
  path?: string
  /** inline plugin (when registered as a value) */
  source?: any
}

let inlineCounter = 0

/**
 * Metadata of a registered plugin or preset (umi's `Plugin`).
 *
 * At runtime each plugin is a cordis fiber mounted on a context that carries
 * this object under {@link kPlugin}, so every registration made by the plugin
 * (or by sub-plugins it mounts with `ctx.plugin()`) can be attributed to it.
 */
export class Plugin {
  type: PluginType
  path: string
  id: string
  key: string
  config: IPluginConfig = {}
  enableBy: EnableBy | EnableByFunction = EnableBy.register
  time: { register?: number; hooks: Record<string, number[]> } = { hooks: {} }
  /** position in registration order; hooks are ordered by it (then by `stage` / `before`) */
  order = 0
  /** the cordis fiber running this plugin, once mounted */
  fiber?: Fiber
  /** context the plugin is mounted under (the registering plugin's context, or the service's) */
  parent?: Context
  /** value returned by an umi-style plugin, presets return `{ presets, plugins }` */
  ret?: any
  /** `true` for cordis-native plugins (`apply(ctx, config)`), which receive `config[key]` as their config */
  native = false
  /** pending queues while the plugin initializes, see `api.registerPlugins()` */
  queue?: { presets?: Plugin[]; plugins: Plugin[] }
  /** local source files the plugin module was built from (empty for packages) */
  dependencies: string[] = []

  private cwd: string
  private source: any
  private resolved: any

  constructor(opts: PluginOptions) {
    this.type = opts.type as PluginType
    this.cwd = opts.cwd
    if (opts.path) {
      this.path = winPath(opts.path)
      const pkgJSONPath = findPackageJSON(this.path)
      let pkg: any = null
      let isPkgEntry = false
      if (pkgJSONPath) {
        pkg = readJSON(pkgJSONPath)
        if (pkg?.name) {
          const entry = tryResolveModule(pkg.name, dirname(pkgJSONPath))
          isPkgEntry = winPath(join(dirname(pkgJSONPath), pkg.main || 'index.js')) === this.path
            || (!!entry && winPath(entry) === this.path)
        }
      }
      this.id = this.getId({ pkg, isPkgEntry, pkgJSONPath })
      this.key = this.getKey({ pkg, isPkgEntry })
    } else {
      this.path = ''
      this.source = opts.source
      const name: string | undefined = typeof opts.source?.name === 'string' && opts.source.name !== 'apply' && opts.source.name
        ? opts.source.name
        : undefined
      this.id = opts.source?.id ?? name ?? `inline-${++inlineCounter}`
      this.key = opts.source?.key ?? (name ? nameToKey(name) : this.id)
    }
  }

  merge(opts: { key?: string; config?: IPluginConfig; enableBy?: any }) {
    if (opts.key) this.key = opts.key
    if (opts.config) this.config = opts.config
    if (opts.enableBy) this.enableBy = opts.enableBy
  }

  getId(opts: { pkg: any; isPkgEntry: boolean; pkgJSONPath?: string }) {
    let id: string
    if (opts.isPkgEntry) {
      id = opts.pkg.name
    } else if (this.path.startsWith(winPath(this.cwd) + '/')) {
      id = `./${winPath(relative(this.cwd, this.path))}`
    } else if (opts.pkgJSONPath && opts.pkg?.name) {
      id = winPath(join(opts.pkg.name, relative(dirname(opts.pkgJSONPath), this.path)))
    } else {
      id = this.path
    }
    id = id.replace('@cormi/preset-react/lib', '@@')
    id = id.replace(/\.(js|mjs|cjs)$/, '')
    return id
  }

  getKey(opts: { pkg: any; isPkgEntry: boolean }) {
    return nameToKey(opts.isPkgEntry
      ? Plugin.stripNoneCormiScope(opts.pkg.name).replace(RE[this.type], '')
      : basename(this.path, extname(this.path)))
  }

  /**
   * Load the module (if registered by path) and normalize it into a cordis plugin.
   * umi-style functions are wrapped so that they receive `ctx.api`.
   */
  async resolve(): Promise<any> {
    if (this.resolved) return this.resolved
    let value = this.source
    if (this.path) {
      let exports: any
      try {
        const loaded = await loadModule(this.path)
        exports = loaded.exports
        this.dependencies = loaded.dependencies
      } catch (cause) {
        throw new Error(`Register ${this.type} ${this.path} failed, since ${(cause as Error)?.message}`, { cause })
      }
      // cordis convention: `export function apply()` next to `export const inject`, ...
      value = typeof exports.apply === 'function' ? exports : unwrapDefault(exports)
    }
    return this.resolved = this.normalize(value)
  }

  /** Forget the loaded module, so that the next `resolve()` imports it again. */
  invalidate() {
    if (this.path) this.resolved = undefined
  }

  private normalize(value: any) {
    if (isNativePlugin(value)) {
      this.native = true
      const meta = value as NativePluginMeta & { Config?: any }
      if (meta.key) this.key = meta.key
      if (meta.enableBy) this.enableBy = meta.enableBy as EnableBy
      this.config = {
        schema: meta.Config,
        default: meta.defaultConfig,
        onChange: meta.onChange ?? 'reloadPlugin',
      }
      return value
    }
    if (typeof value === 'function') {
      const plugin = this
      return {
        name: this.key,
        async apply(ctx: Context) {
          plugin.ret = await value(ctx.api)
        },
      }
    }
    if (lodash.isPlainObject(value) && value.id && value.key) {
      // placeholder: declares a key (and maybe its config) without behavior
      this.merge(value)
      return { name: this.key, apply() {} }
    }
    throw new Error(`Invalid ${this.type} ${this.path || this.id}, expect a function, a cordis plugin or { id, key }.`)
  }

  static isPluginOrPreset(type: 'plugin' | 'preset', name: string) {
    return RE[type].test(Plugin.stripNoneCormiScope(name))
  }

  static stripNoneCormiScope(name: string) {
    if (name.charAt(0) === '@' && !name.startsWith('@cormi/')) {
      name = name.split('/')[1]
    }
    return name
  }
}

/** cordis object / class plugins, and functions carrying cordis statics. */
export function isNativePlugin(value: any) {
  if (!value) return false
  if (isClass(value)) return true
  if (typeof value === 'object') return typeof value.apply === 'function'
  if (typeof value === 'function') {
    return 'inject' in value || 'Config' in value || 'provide' in value
  }
  return false
}

export function isPluginEnabled(plugin: Plugin, opts: {
  skipPluginIds: Set<string>
  userConfig: Record<string, any>
  config: Record<string, any>
  env: Env | `${Env}`
}) {
  const { id, key, enableBy } = plugin
  if (opts.skipPluginIds.has(id)) return false
  if (opts.userConfig[key] === false) return false
  if (opts.config[key] === false) return false
  if (enableBy === EnableBy.config) {
    return key in opts.userConfig || (opts.config && key in opts.config)
  }
  if (typeof enableBy === 'function') {
    return enableBy({ userConfig: opts.userConfig, config: opts.config, env: opts.env as Env })
  }
  return true
}

export function createPlugin(source: PluginSource, type: PluginType | `${PluginType}`, cwd: string) {
  if (typeof source === 'string') {
    const path = tryResolveModule(source, cwd)
    assert(path, `Invalid ${type} ${source}, can not be resolved.`)
    return new Plugin({ path, type, cwd })
  }
  if (source instanceof Plugin) return source
  return new Plugin({ source, type, cwd })
}
