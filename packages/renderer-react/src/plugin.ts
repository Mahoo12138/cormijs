/**
 * Runtime plugin manager (umi's `PluginManager`).
 *
 * Runtime plugins are modules (`src/app.ts` and the ones registered with
 * `api.addRuntimePlugin()`) whose named exports are hooks, e.g.
 * `rootContainer`, `onRouteChange`, `patchClientRoutes`. Only keys declared
 * with `api.addRuntimePluginKey()` (plus the builtin ones) are accepted.
 */
export enum ApplyPluginsType {
  compose = 'compose',
  modify = 'modify',
  event = 'event',
}

export interface RuntimePlugin {
  apply: Record<string, any>
  path?: string
}

export interface PluginManagerOptions {
  plugins?: RuntimePlugin[]
  validKeys: string[]
}

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

export function isPromiseLike(value: any): value is PromiseLike<any> {
  return !!value && typeof value === 'object' && typeof value.then === 'function'
}

/** `compose([a, b, c])(fn)` = `a(b(c(fn)))`, every function receiving the next one. */
function compose(opts: { fns: any[]; args?: any }) {
  if (opts.fns.length === 1) return opts.fns[0]
  const last = opts.fns.pop()
  return opts.fns.reduce((a: any, b: any) => () => b(a, opts.args), last)
}

export class PluginManager {
  hooks: Record<string, any[]> = {}

  constructor(public opts: PluginManagerOptions) {}

  static create(opts: PluginManagerOptions) {
    const manager = new PluginManager({ validKeys: opts.validKeys })
    for (const plugin of opts.plugins ?? []) manager.register(plugin)
    return manager
  }

  register(plugin: RuntimePlugin) {
    assert(plugin.apply, 'plugin register failed, apply must supplied')
    for (const key of Object.keys(plugin.apply)) {
      // `export default defineApp({...})` is unwrapped by the generated plugin list
      if (key === 'default' || key === '__esModule') continue
      assert(
        this.opts.validKeys.includes(key),
        `register failed, invalid key ${key}${plugin.path ? ` from plugin ${plugin.path}` : ''}.`,
      )
      this.hooks[key] = (this.hooks[key] || []).concat(plugin.apply[key])
    }
  }

  /** Supports `key.member` to pick a member of object-shaped hooks. */
  getHooks(keyWithDot: string) {
    const [key, ...memberKeys] = keyWithDot.split('.')
    let hooks = this.hooks[key] || []
    if (memberKeys.length) {
      hooks = hooks.map((hook) => {
        try {
          let ret = hook
          for (const memberKey of memberKeys) ret = ret[memberKey]
          return ret
        } catch {
          return null
        }
      }).filter(Boolean)
    }
    return hooks
  }

  applyPlugins(opts: { key: string; type: ApplyPluginsType | `${ApplyPluginsType}`; initialValue?: any; args?: any; async?: boolean }): any {
    const { key, type, args } = opts
    const hooks = this.getHooks(key)
    if (args) assert(typeof args === 'object', 'applyPlugins failed, args must be plain object.')
    if (opts.async) {
      assert(
        type === ApplyPluginsType.modify || type === ApplyPluginsType.event,
        'async only works with modify and event type.',
      )
    }
    switch (type) {
      case ApplyPluginsType.modify:
        if (opts.async) {
          return hooks.reduce(async (memo: any, hook: any) => {
            assert(
              typeof hook === 'function' || typeof hook === 'object' || isPromiseLike(hook),
              `applyPlugins failed, all hooks for key ${key} must be function, plain object or Promise.`,
            )
            memo = await memo
            if (typeof hook === 'function') return await hook(memo, args)
            return { ...memo, ...(await hook) }
          }, Promise.resolve(opts.initialValue))
        }
        return hooks.reduce((memo: any, hook: any) => {
          assert(
            typeof hook === 'function' || typeof hook === 'object',
            `applyPlugins failed, all hooks for key ${key} must be function or plain object.`,
          )
          if (typeof hook === 'function') return hook(memo, args)
          return { ...memo, ...hook }
        }, opts.initialValue)
      case ApplyPluginsType.event:
        if (opts.async) {
          return (async () => {
            for (const hook of hooks) {
              assert(typeof hook === 'function', `applyPlugins failed, all hooks for key ${key} must be function.`)
              await hook(args)
            }
          })()
        }
        for (const hook of hooks) {
          assert(typeof hook === 'function', `applyPlugins failed, all hooks for key ${key} must be function.`)
          hook(args)
        }
        return
      case ApplyPluginsType.compose:
        return () => compose({
          fns: hooks.concat(opts.initialValue),
          args,
        })()
      default:
        throw new Error(`applyPlugins failed, type is not defined or is not matched, got ${type}.`)
    }
  }
}
