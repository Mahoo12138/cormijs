import type { RequestHandler } from 'express'
import { createProxyMiddleware, type Options } from 'http-proxy-middleware'
import type { IApi } from '../../types.ts'

export interface ProxyConfig extends Options {
  /** umi compatible: `/api` matches `/api/**` */
  context?: string | string[]
  /** skip the proxy for some requests, return a path to rewrite the request instead */
  bypass?: (req: any, res: any, opts: ProxyConfig) => string | void | null | false
}

/**
 * `proxy` config (webpack-dev-server style), either a dict
 * `{ '/api': { target, changeOrigin, pathRewrite } }` or an array of
 * `{ context: ['/api'], target }`.
 */
export function createProxyMiddlewares(proxy: Record<string, ProxyConfig | string> | ProxyConfig[]): RequestHandler[] {
  const entries: { context: string[]; config: ProxyConfig }[] = Array.isArray(proxy)
    ? proxy.map(config => ({ context: [config.context ?? '/'].flat(), config }))
    : Object.entries(proxy).map(([context, config]) => ({
        context: [context],
        config: typeof config === 'string' ? { target: config } : config,
      }))
  return entries.map(({ context, config }) => {
    const { bypass, context: _, ...options } = config
    const middleware = createProxyMiddleware({
      ...options,
      pathFilter: pathname => context.some(prefix => pathname.startsWith(prefix)),
    })
    return (req, res, next) => {
      if (bypass) {
        const result = bypass(req, res, config)
        if (typeof result === 'string') {
          req.url = result
          return next()
        }
        if (result === false) return next()
      }
      return middleware(req, res, next)
    }
  })
}

export default (api: IApi) => {
  api.describe({
    key: 'proxy',
    config: {
      schema: ({ zod }) => zod.union([
        zod.record(zod.string(), zod.union([zod.string(), zod.record(zod.string(), zod.any())])),
        zod.array(zod.record(zod.string(), zod.any())),
      ]),
    },
    enableBy: api.EnableBy.config,
  })

  api.addBeforeMiddlewares(() => {
    return createProxyMiddlewares(api.config.proxy)
  })
}
