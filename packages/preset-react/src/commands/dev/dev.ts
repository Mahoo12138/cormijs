import { existsSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { join } from 'node:path'
import { type ConfigDiff, ConfigChangeType, type IBundlerDevServer, isConfigEqual, lodash, winPath } from '@cormi/core'
import { createMiddleware, type WebHandler } from '@cormi/server'
import express from 'express'
import pc from 'picocolors'
import { DEFAULT_HOST, DEFAULT_PORT } from '../../constants.ts'
import { getHTML } from '../../features/html/getHTML.ts'
import type { GenerateFilesFn, IApi, ITmpGenerateWatcher } from '../../types.ts'
import { getBundler, getBundlerOpts } from '../../utils/bundler.ts'
import { expandCSSPaths, expandJSPaths } from '../../utils/files.ts'
import { getLocalIP, getPort, watch } from '../../utils/watch.ts'

export default (api: IApi) => {
  api.describe({
    enableBy() {
      return api.name === 'dev'
    },
  })

  api.registerCommand({
    name: 'dev',
    description: 'dev server for development',
    details: `
cormi dev

# dev with specified port
PORT=8888 cormi dev
`,
    async fn() {
      api.logger.info(pc.cyan(pc.bold(`Cormi v${api.appData.cormi.version}`)))
      const ctx = api.ctx

      // clear tmp
      rmSync(api.paths.absTmpPath, { recursive: true, force: true })

      await api.applyPlugins({
        key: 'onCheckPkgJSON',
        args: { origin: undefined, current: api.appData.pkg },
      })

      const generate: GenerateFilesFn = async (opts) => {
        await api.applyPlugins({
          key: 'onGenerateFiles',
          args: { files: opts.files || null, isFirstTime: opts.isFirstTime },
        })
      }
      await generate({ isFirstTime: true })

      // regenerate tmp files when convention files change
      const { absPagesPath, absSrcPath } = api.paths
      const watcherPaths: (string | ITmpGenerateWatcher)[] = await api.applyPlugins({
        key: 'addTmpGenerateWatcherPaths',
        initialValue: [
          absPagesPath,
          !api.config.routes && api.config.conventionRoutes?.base && join(api.cwd, api.config.conventionRoutes.base),
          api.paths.absApiRoutesPath,
          join(absSrcPath, 'layouts'),
          ...expandJSPaths(join(absSrcPath, 'loading')),
          ...expandJSPaths(join(absSrcPath, 'app')),
          ...expandJSPaths(join(absSrcPath, 'global')),
          ...expandCSSPaths(join(absSrcPath, 'global')),
          ...expandCSSPaths(join(absSrcPath, 'overrides')),
        ].filter(Boolean),
      })
      const watchers = lodash.uniqBy(
        watcherPaths.map(item => typeof item === 'string' ? { path: winPath(item) } : { ...item, path: winPath(item.path) }),
        item => `${item.path}:${item.events ? [...item.events].sort().join(',') : '*'}`,
      )
      for (const { path, events } of watchers) {
        watch(ctx, path, async (changes) => {
          const files = events ? changes.filter(change => events.includes(change.event)) : changes
          // editing a page only needs HMR; adding / removing files changes the routes
          const relevant = files.filter(change => change.event !== 'change' || !path.startsWith(absPagesPath))
          if (!relevant.length) return
          await generate({ files: relevant, isFirstTime: false })
        }, { debounce: 300 })
      }

      // package.json
      watch(ctx, api.pkgPath, async () => {
        try {
          const origin = api.appData.pkg
          const current = JSON.parse(readFileSync(api.pkgPath, 'utf8'))
          api.appData.pkg = current
          await api.applyPlugins({ key: 'onCheckPkgJSON', args: { origin, current } })
          await api.applyPlugins({ key: 'onPkgJSONChanged', args: { origin, current } })
        } catch (error) {
          api.logger.error(error)
        }
      }, { debounce: 300 })

      // config files
      const configManager = api.service.configManager!
      ctx.effect(() => configManager.watch({
        schemas: () => api.service.configSchemas,
        onChangeTypes: () => api.service.configOnChanges,
        onError: error => api.logger.error(error),
        onChange: async ({ data }) => {
          await applyConfigChange(api, data, generate)
        },
      }), 'watch(config)')

      // local plugins: hot reload cordis-native ones, restart for the others
      const localPlugins = Object.values(api.service.plugins).filter(plugin => plugin.dependencies.length)
      for (const plugin of localPlugins) {
        watch(ctx, plugin.dependencies, async () => {
          if (plugin.native) {
            api.logger.event(`${plugin.id} changed, reload plugin...`)
            await api.service.reloadPluginModule(plugin)
            await generate({ isFirstTime: false })
          } else {
            api.logger.event(`${plugin.id} changed, restart server...`)
            api.restartServer()
          }
        }, { debounce: 300 })
      }

      // `public/` appearing or disappearing changes the bundler config
      const publicDir = join(api.cwd, 'public')
      const hasPublic = () => existsSync(publicDir) && readdirSync(publicDir).length > 0
      const hadPublic = hasPublic()
      watch(ctx, publicDir, () => {
        if (hasPublic() === hadPublic) return
        api.logger.event('public dir changed, restart server...')
        api.restartServer()
      }, { debounce: 300, depth: 0 })

      // server
      const app = express()
      app.disable('x-powered-by')
      const httpServer: Server = createServer(app)
      await api.applyPlugins({ key: 'onBeforeMiddleware', args: { app } })
      const beforeMiddlewares = await api.applyPlugins({ key: 'addBeforeMiddlewares', initialValue: [] })
      const middlewares = await api.applyPlugins({ key: 'addMiddlewares', initialValue: [] })

      const base = api.config.base || '/'
      if (api.config.history?.type === 'browser' && base !== '/') {
        app.use((req, res, next) => {
          if (req.path === '/' && process.env.DEV_SERVER_REDIRECT !== 'none') return res.redirect(base)
          next()
        })
      }
      for (const middleware of beforeMiddlewares.flat()) app.use(middleware)

      const opts = await getBundlerOpts(api, {
        env: api.env,
        httpServer,
        port: api.appData.port,
        host: api.appData.host,
        ip: api.appData.ip,
        onDevCompileDone(opts) {
          api.appData.bundleStatus.done = true
          api.applyPlugins({ key: 'onDevCompileDone', args: opts }).catch(error => api.logger.error(error))
        },
        onProgress(opts) {
          api.appData.bundleStatus.progress = opts
        },
      })
      const bundler = await getBundler(api, opts)
      const devServer: IBundlerDevServer = await bundler.dev(opts)
      ctx.effect(() => () => devServer.close(), 'bundler.dev()')
      app.use(devServer.middlewares)

      const getTemplate = async (url: URL) => {
        const html = await getHTML(api, {
          path: url.pathname,
          entryScripts: devServer.getEntryScripts('cormi').map(src => ({ src, type: 'module' })),
        })
        return devServer.transformIndexHtml(url.pathname + url.search, html)
      }

      // API routes, server loaders and SSR, through the server entry
      const serverHandler: WebHandler = async (request) => {
        const serverEntry = api.appData.serverEntry
        if (!serverEntry) return
        const mod = await devServer.loadModule(serverEntry)
        const handler: WebHandler = mod.createRequestHandler({
          getTemplate,
          onError: (error: unknown) => api.logger.error(error),
        })
        return handler(request)
      }
      app.use(createMiddleware(serverHandler))
      for (const middleware of middlewares.flat()) app.use(middleware)

      // every other HTML request gets the app
      app.use(createMiddleware(async (request) => {
        const accept = request.headers.get('accept') || ''
        if (request.method !== 'GET' || !(accept.includes('text/html') || accept === '*/*')) return
        const html = await getTemplate(new URL(request.url))
        return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
      }))

      const { port, host } = api.appData
      await new Promise<void>((resolve, reject) => {
        httpServer.once('error', reject)
        httpServer.listen(port, host, () => resolve())
      })
      ctx.effect(() => () => new Promise<void>((resolve) => {
        httpServer.closeAllConnections?.()
        httpServer.close(() => resolve())
      }), 'listen()')
      const protocol = 'http'
      const local = `${protocol}://localhost:${port}`
      const network = api.appData.ip ? `${protocol}://${api.appData.ip}:${port}` : undefined
      api.logger.ready(`App listening at:\n  > Local:   ${pc.cyan(local)}${network ? `\n  > Network: ${pc.cyan(network)}` : ''}`)
      api.appData.devServer = { url: local, network }
    },
  })

  api.modifyAppData(async (memo) => {
    // keep the port across in-process restarts, so that open pages reconnect
    const preferred = parseInt(String(process.env.CORMI_DEV_PORT || process.env.PORT || DEFAULT_PORT), 10)
    memo.host = process.env.HOST || DEFAULT_HOST
    memo.port = process.env.STRICT_PORT ? parseInt(process.env.STRICT_PORT, 10) : await getPort(preferred)
    if (process.env.STRICT_PORT && memo.port !== await getPort(memo.port)) {
      throw new Error(`Port ${memo.port} is not available, please use another port.`)
    }
    process.env.CORMI_DEV_PORT = String(memo.port)
    memo.ip = getLocalIP()
    return memo
  })

  api.registerMethod({
    name: 'restartServer',
    fn(opts: { hard?: boolean } = {}) {
      // a hard restart starts a fresh process (new module cache), when run by the daemon
      if (opts.hard && process.env.CORMI_DAEMON) {
        api.logger.info('Restart dev server in a new process...')
        api.service.fiber.dispose().finally(() => process.exit(51))
        return
      }
      api.logger.info(`Restart dev server with port ${api.appData.port}...`)
      api.service.restart().catch(error => api.logger.error(error))
    },
  })

  api.onPkgJSONChanged(({ origin, current }) => {
    const keys = ['dependencies', 'devDependencies', 'peerDependencies']
    if (keys.every(key => isConfigEqual(origin?.[key], current?.[key]))) return
    api.logger.event('dependencies changed, restart server...')
    api.restartServer({ hard: true })
  })
}

/** Apply a config change in dev according to the `onChange` type of each key. */
export async function applyConfigChange(api: IApi, data: ConfigDiff, generate: GenerateFilesFn) {
  const service = api.service
  await api.applyPlugins({
    key: 'onCheckConfig',
    args: { config: api.config, userConfig: api.userConfig },
  })
  const reload = data.changes[ConfigChangeType.reload]
  if (reload) {
    api.logger.event(`config ${reload.join(', ')} changed, restart server...`)
    api.restartServer()
    return
  }
  await service.resolveConfig()
  const reloadPlugin = data.changes[ConfigChangeType.reloadPlugin]
  if (reloadPlugin) {
    api.logger.event(`config ${reloadPlugin.join(', ')} changed, reload plugin...`)
    for (const key of reloadPlugin) {
      const plugin = service.keyToPluginMap[key]
      if (plugin) await service.reloadPlugin(plugin)
    }
  }
  const regenerate = data.changes[ConfigChangeType.regenerateTmpFiles]
  if (regenerate || reloadPlugin) {
    if (regenerate) api.logger.event(`config ${regenerate.join(', ')} changed, regenerate tmp files...`)
    await generate({ isFirstTime: false })
  }
  for (const fn of data.fns) {
    await fn({ generate })
  }
}
