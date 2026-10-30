import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Context } from 'cordis'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { tmpdir } from 'node:os'
import { rmSync } from 'node:fs'
import { Cormi } from '../src/service.ts'
import { ApplyPluginsType, Env, EnableBy, ServiceStage } from '../src/types.ts'

function makeCwd() {
  const dir = join(tmpdir(), `cormi-test-${Math.random().toString(16).slice(2, 8)}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

describe('Cormi service', () => {
  let cwd: string
  let ctx: Context

  beforeEach(() => {
    cwd = makeCwd()
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ name: 'test-app', version: '0.0.0' }))
    ctx = new Context()
  })

  afterEach(async () => {
    await ctx.fiber.dispose()
    rmSync(cwd, { recursive: true, force: true })
  })

  it('runs a command and returns its result', async () => {
    const fiber = ctx.plugin(Cormi, {
      cwd,
      env: Env.production,
      plugins: [
        (api: any) => {
          api.registerCommand({
            name: 'hello',
            fn: () => 'world',
          })
        },
      ],
      name: 'hello',
    })
    await fiber
    const cormi = ctx.cormi
    expect(cormi.result).toBe('world')
  })

  it('applyPlugins: add', async () => {
    const fiber = ctx.plugin(Cormi, {
      cwd,
      env: Env.production,
      plugins: [
        (api: any) => {
          api.registerMethod({ name: 'addFoo' })
          api.addFoo(() => 'a')
          api.addFoo(() => 'b')
          api.registerCommand({
            name: 'run',
            fn: async () => {
              return api.applyPlugins({ key: 'addFoo', type: ApplyPluginsType.add })
            },
          })
        },
      ],
      name: 'run',
    })
    await fiber
    expect(ctx.cormi.result).toEqual(['a', 'b'])
  })

  it('applyPlugins: modify', async () => {
    const fiber = ctx.plugin(Cormi, {
      cwd,
      env: Env.production,
      plugins: [
        (api: any) => {
          api.registerMethod({ name: 'modifyVal' })
          api.modifyVal((memo: number) => memo + 10)
          api.registerCommand({
            name: 'run',
            fn: async () => api.applyPlugins({ key: 'modifyVal', type: ApplyPluginsType.modify, initialValue: 1 }),
          })
        },
      ],
      name: 'run',
    })
    await fiber
    expect(ctx.cormi.result).toBe(11)
  })

  it('skipPlugins disables hooks', async () => {
    const calls: string[] = []
    const fiber = ctx.plugin(Cormi, {
      cwd,
      env: Env.production,
      plugins: [
        (api: any) => {
          api.describe({ key: 'plugin1' })
          api.registerMethod({ name: 'onFoo' })
          api.onFoo(() => calls.push('plugin1'))
        },
        (api: any) => {
          api.describe({ key: 'plugin2' })
          api.onFoo(() => calls.push('plugin2'))
        },
        (api: any) => {
          api.skipPlugins(['plugin2'])
          api.registerCommand({
            name: 'run',
            fn: () => api.applyPlugins({ key: 'onFoo', type: ApplyPluginsType.event }),
          })
        },
      ],
      name: 'run',
    })
    await fiber
    expect(calls).toEqual(['plugin1'])
  })

  it('preset registers presets and plugins', async () => {
    const order: string[] = []
    const fiber = ctx.plugin(Cormi, {
      cwd,
      env: Env.production,
      presets: [
        (api: any) => {
          order.push('preset')
          return {
            plugins: [
              (api2: any) => {
                order.push('plugin-from-preset')
                api2.registerCommand({ name: 'run', fn: () => order })
              },
            ],
          }
        },
      ],
      name: 'run',
    })
    await fiber
    expect(order).toContain('preset')
    expect(order).toContain('plugin-from-preset')
    expect(ctx.cormi.result).toContain('preset')
  })

  it('stage progresses from init to runCommand', async () => {
    const stages: ServiceStage[] = []
    const fiber = ctx.plugin(Cormi, {
      cwd,
      env: Env.production,
      plugins: [
        (api: any) => {
          api.onStart(() => stages.push(api.ServiceStage.onStart))
          api.onCheck(() => stages.push(api.ServiceStage.onCheck))
          api.registerCommand({ name: 'run', fn: () => stages.push(api.ServiceStage.runCommand) })
        },
      ],
      name: 'run',
    })
    await fiber
    expect(stages).toEqual([ServiceStage.onCheck, ServiceStage.onStart, ServiceStage.runCommand])
  })

  it('plugin disposal removes command', async () => {
    const fiber = ctx.plugin(Cormi, {
      cwd,
      env: Env.production,
      plugins: [],
    })
    await fiber
    const cormi = ctx.cormi
    const pluginCtx = cormi.ctx.extend()
    pluginCtx.effect(() => {
      cormi.ctx.api.registerCommand({ name: 'temp', fn: () => {} })
      return () => {}
    })
    expect('temp' in cormi.commands).toBe(true)
  })
})
