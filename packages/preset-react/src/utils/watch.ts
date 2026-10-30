import { createServer } from 'node:net'
import { networkInterfaces } from 'node:os'
import type { Context } from 'cordis'
import { watch as chokidarWatch, type ChokidarOptions } from 'chokidar'
import { lodash } from '@cormi/core'

function isPortFree(port: number, host?: string) {
  return new Promise<boolean>((resolve) => {
    const server = createServer()
    server.unref()
    server.once('error', () => resolve(false))
    server.listen({ port, host }, () => server.close(() => resolve(true)))
  })
}

/** The first free port from `port` on (umi uses portfinder). */
export async function getPort(port: number, host?: string) {
  for (let i = 0; i < 100; i++) {
    if (await isPortFree(port + i, host)) return port + i
  }
  throw new Error(`No free port found from ${port}.`)
}

export function getLocalIP() {
  for (const items of Object.values(networkInterfaces())) {
    for (const item of items ?? []) {
      if (item.family === 'IPv4' && !item.internal) return item.address
    }
  }
}

export interface WatchOptions extends ChokidarOptions {
  /** debounce file events (ms) */
  debounce?: number
}

/**
 * Watch files as a cordis effect: the watcher closes when the calling plugin
 * (the owner of `ctx`) is disposed or reloaded.
 */
export function watch(
  ctx: Context,
  paths: string | string[],
  onChange: (events: { event: string; path: string }[]) => void | Promise<void>,
  opts: WatchOptions = {},
) {
  const { debounce = 0, ...chokidarOptions } = opts
  return ctx.effect(() => {
    const watcher = chokidarWatch(paths, { ignoreInitial: true, ...chokidarOptions })
    let queue: { event: string; path: string }[] = []
    const flush = () => {
      const events = queue
      queue = []
      if (!events.length) return
      Promise.resolve(onChange(lodash.uniqBy(events, item => `${item.event}:${item.path}`))).catch(error => ctx.logger.error(error))
    }
    const debounced = debounce ? lodash.debounce(flush, debounce) : flush
    watcher.on('all', (event, path) => {
      queue.push({ event, path })
      debounced()
    })
    return async () => {
      ;(debounced as any).cancel?.()
      await watcher.close()
    }
  }, `watch(${JSON.stringify(paths)})`)
}
