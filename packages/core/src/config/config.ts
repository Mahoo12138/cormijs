import { existsSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { FSWatcher, watch as chokidarWatch } from 'chokidar'
import { DEFAULT_CONFIG_FILES, LOCAL_EXT, SHORT_ENV, WATCH_DEBOUNCE_STEP } from '../constants.ts'
import { formatIssues, resolveSchema, validateSchema } from '../schema.ts'
import { Env, IOnChangeTypes, IPluginConfig } from '../types.ts'
import { lodash, loadModule, unwrapDefault, winPath } from '../utils/index.ts'

export interface ConfigOptions {
  cwd: string
  env: Env | `${Env}`
  /** value of `CORMI_ENV`, selects `.cormirc.<specifiedEnv>.ts` */
  specifiedEnv?: string
  defaultConfigFiles?: string[]
}

export type ConfigSchemas = Record<string, IPluginConfig['schema']>

export interface ConfigDiff {
  /** changed keys grouped by their `onChange` type (`reload`, `regenerateTmpFiles`, ...) */
  changes: Record<string, string[]>
  /** custom `onChange` handlers of changed keys */
  fns: Function[]
  /** all changed top-level keys */
  keys: string[]
}

export class Config {
  public mainConfigFile: string | null
  public prevConfig: { config: Record<string, any>; files: string[] } | null = null
  public files: string[] = []

  constructor(public opts: ConfigOptions) {
    this.mainConfigFile = Config.getMainConfigFile(opts)
  }

  async getUserConfig() {
    const configFiles = Config.getConfigFiles({
      mainConfigFile: this.mainConfigFile,
      env: this.opts.env,
      specifiedEnv: this.opts.specifiedEnv,
    })
    return Config.getUserConfig({
      configFiles: configFiles.map(file => isAbsolute(file) ? file : join(this.opts.cwd, file)),
    })
  }

  async getConfig(opts: { schemas: ConfigSchemas }) {
    const { config, files } = await this.getUserConfig()
    Config.validateConfig({ config, schemas: opts.schemas })
    this.files = files
    return this.prevConfig = { config, files }
  }

  /**
   * Watch config files (and everything they import). On change the user config
   * is reloaded and validated, then `onChange` receives the keys that changed,
   * grouped by the `onChange` type their plugins declared.
   *
   * Returns a disposer; callers wrap it in `ctx.effect()`.
   */
  watch(opts: {
    schemas: ConfigSchemas | (() => ConfigSchemas)
    onChangeTypes: IOnChangeTypes | (() => IOnChangeTypes)
    onChange: (opts: { data: ConfigDiff; event: string; path: string }) => Promise<void>
    onError?: (error: unknown) => void
  }) {
    const getSchemas = () => typeof opts.schemas === 'function' ? opts.schemas() : opts.schemas
    const getOnChangeTypes = () => typeof opts.onChangeTypes === 'function' ? opts.onChangeTypes() : opts.onChangeTypes
    const initial = [
      ...this.files,
      ...(this.mainConfigFile
        ? []
        : (this.opts.defaultConfigFiles ?? DEFAULT_CONFIG_FILES).map(file => join(this.opts.cwd, file))),
    ]
    const watcher: FSWatcher = chokidarWatch(initial, { ignoreInitial: true })
    let disposed = false
    const handler = lodash.debounce(async (event: string, path: string) => {
      if (disposed) return
      try {
        if (!this.mainConfigFile) this.mainConfigFile = Config.getMainConfigFile(this.opts)
        const origin = this.prevConfig?.config ?? {}
        const { config: updated, files } = await this.getConfig({ schemas: getSchemas() })
        watcher.add(files)
        const data = Config.diffConfigs({ origin, updated, onChangeTypes: getOnChangeTypes() })
        if (!data.keys.length) return
        await opts.onChange({ data, event, path })
      } catch (error) {
        opts.onError?.(error)
      }
    }, WATCH_DEBOUNCE_STEP)
    watcher.on('all', handler)
    return async () => {
      disposed = true
      handler.cancel()
      await watcher.close()
    }
  }

  static getMainConfigFile(opts: { cwd: string; defaultConfigFiles?: string[] }) {
    for (const configFile of opts.defaultConfigFiles ?? DEFAULT_CONFIG_FILES) {
      const absConfigFile = join(opts.cwd, configFile)
      if (existsSync(absConfigFile)) return winPath(absConfigFile)
    }
    return null
  }

  static getConfigFiles(opts: { mainConfigFile: string | null; env: Env | `${Env}`; specifiedEnv?: string }) {
    const ret: string[] = []
    const { mainConfigFile } = opts
    const specifiedEnv = opts.specifiedEnv || ''
    if (!mainConfigFile) return ret
    const env = SHORT_ENV[opts.env] || opts.env
    ret.push(...[
      mainConfigFile,
      specifiedEnv && addExt({ file: mainConfigFile, ext: `.${specifiedEnv}` }),
      addExt({ file: mainConfigFile, ext: `.${env}` }),
      specifiedEnv && addExt({ file: mainConfigFile, ext: `.${env}.${specifiedEnv}` }),
    ].filter(Boolean) as string[])
    if (opts.env === Env.development) {
      ret.push(addExt({ file: mainConfigFile, ext: LOCAL_EXT }))
    }
    return ret
  }

  /** Load and deep-merge the config files that exist; also returns the files to watch. */
  static async getUserConfig(opts: { configFiles: string[] }) {
    let config: Record<string, any> = {}
    const files: string[] = []
    for (const configFile of opts.configFiles) {
      if (!existsSync(configFile)) {
        // watch it, so that creating it later takes effect
        files.push(winPath(configFile))
        continue
      }
      let loaded
      try {
        loaded = await loadModule(configFile)
      } catch (cause) {
        throw new Error(`Parse config file failed: [${configFile}]`, { cause })
      }
      config = lodash.merge(config, unwrapDefault(loaded.exports) ?? {})
      files.push(...loaded.dependencies)
    }
    return { config, files: lodash.uniq(files) }
  }

  static validateConfig(opts: { config: Record<string, any>; schemas: ConfigSchemas }) {
    const errors = new Map<string, string>()
    const configKeys = new Set(Object.keys(opts.config))
    for (const key of Object.keys(opts.schemas)) {
      configKeys.delete(key)
      const value = opts.config[key]
      // `false` disables a plugin, `undefined` / `null` means "not configured"
      if (value === undefined || value === null || value === false) continue
      const schema = resolveSchema(opts.schemas[key])
      if (!schema) continue
      const result = validateSchema(schema, value)
      if (result.issues) errors.set(key, formatIssues(result.issues))
    }
    if (errors.size) {
      throw new Error(`Invalid config values: ${[...errors.keys()].join(', ')}\n${
        [...errors].map(([key, message]) => `Invalid value for ${key}:\n${message}`).join('\n')
      }`)
    }
    if (configKeys.size) {
      throw new Error(`Invalid config keys: ${[...configKeys].join(', ')}`)
    }
  }

  static diffConfigs(opts: { origin: Record<string, any>; updated: Record<string, any>; onChangeTypes: IOnChangeTypes }): ConfigDiff {
    const keys = Object.keys({ ...opts.origin, ...opts.updated })
      .filter(key => !isConfigEqual(opts.origin[key], opts.updated[key]))
    const changes: Record<string, string[]> = {}
    const fns: Function[] = []
    for (const key of keys) {
      const onChange = opts.onChangeTypes[key] ?? 'reload'
      if (typeof onChange === 'string') {
        (changes[onChange] ||= []).push(key)
      } else if (typeof onChange === 'function') {
        fns.push(onChange)
      } else {
        throw new Error(`Invalid onChange value for key ${key}`)
      }
    }
    return { changes, fns, keys }
  }
}

export function addExt(opts: { file: string; ext: string }) {
  const index = opts.file.lastIndexOf('.')
  return `${opts.file.slice(0, index)}${opts.ext}${opts.file.slice(index)}`
}

/** Deep equality where functions compare by source (a reloaded config yields new function objects). */
export function isConfigEqual(a: any, b: any): boolean {
  if (a === b) return true
  if (typeof a === 'function' && typeof b === 'function') return a.toString() === b.toString()
  if (a instanceof RegExp && b instanceof RegExp) return a.toString() === b.toString()
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys({ ...a, ...b })
  return keys.every(key => isConfigEqual(a[key], b[key]))
}
