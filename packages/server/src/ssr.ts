import type { PluginManager } from '@cormi/renderer-react'
import {
  executeServerLoaders,
  getServerRootElement,
  matchRouteIds,
  renderToHTML,
} from '@cormi/renderer-react/server'
import { injectIntoTemplate, serializeForScript } from './markup.ts'

export interface AppHandlerOptions {
  /** `getRoutes()` of the generated `core/route.tsx` */
  getRoutes: () => Promise<{ routes: Record<string, any>; routeComponents: Record<string, any> }>
  createPluginManager: () => PluginManager
  /** import a route module, to call its `serverLoader` */
  loadRouteModule: (id: string) => Promise<any>
  /** HTML template of the page (built `index.html` in production, transformed markup in dev) */
  getTemplate: (url: URL) => Promise<string>
  /** make `history` from the app's `core/history.ts` point at the requested url */
  createHistory?: (opts: { type: 'memory'; initialEntries: string[]; initialIndex: number }) => any
  basename?: string
  mountElementId?: string
  /** render pages on the server; `false` only serves `/__serverLoader` */
  ssr?: boolean
  useStream?: boolean
  reactRouter5Compat?: boolean
  onError?: (error: unknown, request: Request) => void
}

function stripBase(pathname: string, basename = '/') {
  const base = basename.replace(/\/+$/, '')
  if (!base) return pathname
  if (pathname === base) return '/'
  return pathname.startsWith(base + '/') ? pathname.slice(base.length) : pathname
}

function acceptsHTML(request: Request) {
  const accept = request.headers.get('accept') || ''
  return accept.includes('text/html') || accept === '*/*' || !accept
}

/**
 * Request handler for server loaders and server-side rendering. Resolves to
 * `undefined` when the request is not for it (no matching route, not HTML).
 */
export function createAppHandler(opts: AppHandlerOptions) {
  const basename = opts.basename || '/'

  async function loadRoutes() {
    const pluginManager = opts.createPluginManager()
    const { routes, routeComponents } = await opts.getRoutes()
    pluginManager.applyPlugins({
      key: 'patchRoutes',
      type: 'event',
      args: { routes, routeComponents },
    })
    return { routes, routeComponents, pluginManager }
  }

  async function handleServerLoader(request: Request, url: URL) {
    const id = url.searchParams.get('route')
    const target = url.searchParams.get('url')
    if (!id || !target) return new Response('Bad Request', { status: 400 })
    const { routes } = await loadRoutes()
    if (!routes[id]?.hasServerLoader) return Response.json(null)
    const targetUrl = new URL(target, url)
    const { params } = matchRouteIds(routes, targetUrl.pathname, basename)
    const loaderRequest = new Request(targetUrl, { headers: request.headers })
    const data = await executeServerLoaders({
      ids: [id],
      routes,
      request: loaderRequest,
      params,
      loadRouteModule: opts.loadRouteModule,
    })
    return Response.json(data[id] ?? null)
  }

  async function handlePage(request: Request, url: URL) {
    const { routes, routeComponents, pluginManager } = await loadRoutes()
    const { ids, params } = matchRouteIds(routes, url.pathname, basename)
    // only layouts matched: not a page of this app
    if (!ids.length || ids.every(id => routes[id]?.isLayout)) return
    const location = url.pathname + url.search
    opts.createHistory?.({ type: 'memory', initialEntries: [location], initialIndex: 0 })
    const loaderData = await executeServerLoaders({
      ids,
      routes,
      request,
      params,
      loadRouteModule: opts.loadRouteModule,
    })
    const template = await opts.getTemplate(url)
    const element = getServerRootElement({
      routes,
      routeComponents,
      pluginManager,
      location,
      loaderData,
      basename,
      useStream: opts.useStream,
      reactRouter5Compat: opts.reactRouter5Compat,
    })
    const { html, head } = await renderToHTML(element, {
      onError: error => opts.onError?.(error, request),
    })
    const page = injectIntoTemplate(template, {
      mountElementId: opts.mountElementId,
      html,
      head,
      bodyEnd: `<script>window.__CORMI_LOADER_DATA__ = ${serializeForScript(loaderData)}</script>`,
    })
    // the loader data script must run before the entry module
    return new Response(moveLoaderDataBeforeEntry(page), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  return async (request: Request): Promise<Response | undefined> => {
    const url = new URL(request.url)
    const pathname = stripBase(url.pathname, basename)
    try {
      if (pathname === '/__serverLoader') return await handleServerLoader(request, url)
      if (!opts.ssr || request.method !== 'GET' || !acceptsHTML(request)) return
      return await handlePage(request, url)
    } catch (error) {
      opts.onError?.(error, request)
      if (pathname === '/__serverLoader') return new Response('Internal Server Error', { status: 500 })
      // fall back to client-side rendering
      return
    }
  }
}

/** Module scripts are deferred, but keep the inline data script first anyway for clarity. */
function moveLoaderDataBeforeEntry(html: string) {
  const match = /<script>window\.__CORMI_LOADER_DATA__[\s\S]*?<\/script>/.exec(html)
  if (!match) return html
  const withoutData = html.slice(0, match.index) + html.slice(match.index + match[0].length)
  return withoutData.replace(/<\/head>/i, `${match[0]}</head>`)
}
