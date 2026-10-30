import { existsSync, readFileSync } from 'node:fs'
import type { Server } from 'node:http'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import express, { type Express } from 'express'
import { createMiddleware, type WebHandler } from './node.ts'

/** Contract of the server bundle built from the generated `server.ts`. */
export interface ServerBundle {
  createRequestHandler(opts: { getTemplate: (url: URL) => Promise<string> }): WebHandler
}

export interface ProductionServerOptions {
  /** the build output directory (`dist`) */
  outputPath: string
  /** path of the server bundle; defaults to `<outputPath>/server/server.mjs` if it exists */
  serverBundle?: string
  /** `publicPath` of the build */
  publicPath?: string
  /** router basename */
  base?: string
  /** fall back to `index.html` for unknown HTML requests (single page app) */
  spaFallback?: boolean
  /** middlewares running before everything else (proxy, mock, ...) */
  beforeMiddlewares?: express.RequestHandler[]
  onError?: (error: unknown) => void
}

/**
 * The production server of a cormi app: static assets, API routes,
 * server loaders and SSR (when the app was built with them), then an SPA
 * fallback to `index.html`.
 */
export async function createProductionServer(opts: ProductionServerOptions) {
  const { outputPath, publicPath = '/', spaFallback = true } = opts
  const app: Express = express()
  app.disable('x-powered-by')
  for (const middleware of opts.beforeMiddlewares ?? []) app.use(middleware)

  const templatePath = join(outputPath, 'index.html')
  const readTemplate = () => readFileSync(templatePath, 'utf8')

  app.use(publicPath, express.static(outputPath, {
    index: false,
    // the server bundle is not a public asset
    setHeaders(res, path) {
      if (/[.-][0-9a-zA-Z_-]{8,}\.(js|css|mjs)$/.test(path)) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
    },
  }))

  const serverBundle = opts.serverBundle ?? join(outputPath, 'server', 'server.mjs')
  if (existsSync(serverBundle)) {
    const bundle: ServerBundle = await import(pathToFileURL(serverBundle).href)
    const handler = bundle.createRequestHandler({
      getTemplate: async (url) => {
        // prefer an exported page (`exportStatic`) as template
        const page = join(outputPath, url.pathname, 'index.html')
        return existsSync(page) ? readFileSync(page, 'utf8') : readTemplate()
      },
    })
    app.use(createMiddleware(handler))
  }

  if (spaFallback) {
    app.use((req, res, next) => {
      if (req.method !== 'GET' || !(req.headers.accept ?? '').includes('text/html')) return next()
      const exported = join(outputPath, req.path, 'index.html')
      const file = existsSync(exported) ? exported : templatePath
      if (!existsSync(file)) return next()
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(readFileSync(file, 'utf8'))
    })
  }

  app.use(((error: any, _req: any, res: any, _next: any) => {
    opts.onError?.(error)
    res.statusCode = 500
    res.end('Internal Server Error')
  }) as express.ErrorRequestHandler)

  return {
    app,
    listen(port: number, host?: string) {
      return new Promise<Server>((resolve, reject) => {
        const server = app.listen(port, host ?? '0.0.0.0', (error?: Error) => {
          if (error) reject(error)
          else resolve(server)
        })
      })
    },
  }
}
