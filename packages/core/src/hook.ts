import type { Context, Fiber } from 'cordis'
import { kPlugin, type Plugin } from './plugin.ts'

declare module 'cordis' {
  interface EventOptions {
    /** umi hook ordering: lower stages run earlier (default 0) */
    stage?: number
    /** umi hook ordering: run before the hooks of these plugin keys */
    before?: string | string[]
    /** name used by other hooks' `before`, defaults to the plugin key */
    name?: string
  }
}

/**
 * An umi hook. Hooks are stored as cordis event listeners: `api.register({ key, fn })`
 * is `ctx.on(key, fn, { stage, before })`, so a hook is an effect of the plugin
 * fiber that registered it and disappears when that plugin unloads.
 */
export interface Hook {
  key: string
  fn: (...args: any[]) => any
  plugin?: Plugin
  stage: number
  before?: string | string[]
  name?: string
  ctx: Context
}

interface RawListener {
  ctx: Context
  callback: (...args: any[]) => any
  stage?: number
  before?: string | string[]
  name?: string
}

export function isDescendant(fiber: Fiber, ancestor: Fiber) {
  while (true) {
    if (fiber === ancestor) return true
    const parent = fiber.parent.fiber
    if (parent === fiber) return false
    fiber = parent
  }
}

/** Collect the hooks registered for `key` by fibers under `scope`. */
export function collectHooks(ctx: Context, key: string, scope: Fiber): Hook[] {
  const listeners: RawListener[] = (ctx.events as any)._hooks[key] ?? []
  return listeners
    .filter(listener => isDescendant(listener.ctx.fiber, scope))
    .map(listener => ({
      key,
      fn: listener.callback,
      plugin: listener.ctx[kPlugin],
      stage: listener.stage ?? 0,
      before: listener.before,
      name: listener.name,
      ctx: listener.ctx,
    }))
}

function tapName(hook: Hook) {
  return hook.name ?? hook.plugin?.key
}

/** tapable's insertion: honor `before`, then keep stages ascending. */
function insert(taps: Hook[], item: Hook) {
  let before: Set<string> | undefined
  if (typeof item.before === 'string') {
    before = new Set([item.before])
  } else if (Array.isArray(item.before)) {
    before = new Set(item.before)
  }
  const stage = item.stage
  let i = taps.length
  while (i > 0) {
    i--
    const x = taps[i]
    taps[i + 1] = x
    const xStage = x.stage
    if (before) {
      const name = tapName(x)
      if (name !== undefined && before.has(name)) {
        before.delete(name)
        continue
      }
      if (before.size > 0) continue
    }
    if (xStage > stage) continue
    i++
    break
  }
  taps[i] = item
}

/**
 * Order hooks like umi: registration order of their plugins (stable across
 * plugin reloads, since a reloaded plugin keeps its position), then tapable
 * semantics for `stage` and `before`.
 */
export function orderHooks(hooks: Hook[]): Hook[] {
  const sorted = hooks
    .map((hook, index) => ({ hook, index }))
    .sort((a, b) => {
      const orderA = a.hook.plugin?.order ?? Infinity
      const orderB = b.hook.plugin?.order ?? Infinity
      if (orderA !== orderB) return orderA - orderB
      return a.index - b.index
    })
  const taps: Hook[] = []
  for (const { hook } of sorted) insert(taps, hook)
  return taps
}
