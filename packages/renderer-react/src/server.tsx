import { Writable } from 'node:stream'
import React from 'react'
import { renderToPipeableStream, renderToString } from 'react-dom/server'
import { matchRoutes, StaticRouter } from 'react-router'
import { AppContext } from './appContext.ts'
import { applyProviders, Routes } from './browser.tsx'
import type { PluginManager } from './plugin.ts'
import { createClientRoutes } from './routes.tsx'
import { ServerInsertedHTMLContext } from './serverInsertedHTML.tsx'
import type { ILoaderData, IRouteComponents, IRoutesById, ServerLoader } from './types.ts'

export interface ServerRootOptions {
  routes: IRoutesById
  routeComponents: IRouteComponents
  pluginManager: PluginManager
  /** path (with basename) and search of the request */
  location: string
  loaderData: ILoaderData
  basename?: string
  useStream?: boolean
  reactRouter5Compat?: boolean
  loadingComponent?: React.ComponentType
}

/** The app element rendered on the server (`StaticRouter` + runtime providers). */
export function getServerRootElement(opts: ServerRootOptions) {
  const basename = opts.basename || '/'
  const clientRoutes = createClientRoutes({
    routesById: opts.routes,
    routeComponents: opts.routeComponents,
    useStream: opts.useStream,
    loadingComponent: opts.loadingComponent,
    reactRouter5Compat: opts.reactRouter5Compat,
  })
  opts.pluginManager.applyPlugins({
    key: 'patchClientRoutes',
    type: 'event',
    args: { routes: clientRoutes },
  })
  const rootContainer = applyProviders(
    <StaticRouter basename={basename} location={opts.location}>
      <Routes />
    </StaticRouter>,
    opts.pluginManager,
    { routes: opts.routes },
  )
  return (
    <AppContext.Provider
      value={{
        routes: opts.routes,
        routeComponents: opts.routeComponents,
        clientRoutes,
        pluginManager: opts.pluginManager,
        basename,
        clientLoaderData: {},
        serverLoaderData: opts.loaderData,
      }}
    >
      {rootContainer}
    </AppContext.Provider>
  )
}

/** Ids of the routes matching `pathname`, outermost first. */
export function matchRouteIds(routes: IRoutesById, pathname: string, basename = '/') {
  const clientRoutes = createClientRoutes({ routesById: routes, routeComponents: {} })
  const matches = matchRoutes(clientRoutes as any, pathname, basename) || []
  return {
    ids: matches.map(match => (match.route as any).id as string),
    params: matches.at(-1)?.params ?? {},
  }
}

/**
 * Run the `serverLoader` of every matched route that has one.
 * `loadRouteModule(id)` returns the route module (with `serverLoader` export).
 */
export async function executeServerLoaders(opts: {
  ids: string[]
  routes: IRoutesById
  request: Request
  params: Record<string, string | undefined>
  loadRouteModule: (id: string) => Promise<{ serverLoader?: ServerLoader }>
}) {
  const loaderData: ILoaderData = {}
  await Promise.all(opts.ids
    .filter(id => opts.routes[id]?.hasServerLoader)
    .map(async (id) => {
      const mod = await opts.loadRouteModule(id)
      if (typeof mod.serverLoader !== 'function') return
      loaderData[id] = await mod.serverLoader({ request: opts.request, params: opts.params })
    }))
  return loaderData
}

/**
 * Render an element to an HTML string, waiting for every suspense boundary
 * (lazy route components) to resolve. Returns the markup plus the HTML
 * collected with `useServerInsertedHTML()`.
 */
export function renderToHTML(element: React.ReactElement, opts: { onError?: (error: unknown) => void } = {}) {
  const insertedCallbacks = new Set<() => React.ReactNode>()
  const addInsertedHTML = (callback: () => React.ReactNode) => {
    insertedCallbacks.add(callback)
  }
  return new Promise<{ html: string; head: string }>((resolve, reject) => {
    const chunks: Buffer[] = []
    const writable = new Writable({
      write(chunk, _encoding, next) {
        chunks.push(Buffer.from(chunk))
        next()
      },
    })
    writable.on('finish', () => {
      const head = renderToString(
        <>{[...insertedCallbacks].map((callback, index) => <React.Fragment key={index}>{callback()}</React.Fragment>)}</>,
      )
      resolve({ html: Buffer.concat(chunks).toString('utf8'), head })
    })
    let failed = false
    const stream = renderToPipeableStream(
      <ServerInsertedHTMLContext.Provider value={addInsertedHTML}>{element}</ServerInsertedHTMLContext.Provider>,
      {
        onAllReady() {
          if (!failed) stream.pipe(writable)
        },
        onShellError(error) {
          failed = true
          reject(error)
        },
        onError(error) {
          opts.onError?.(error)
        },
      },
    )
  })
}

export { ServerInsertedHTMLContext, useServerInsertedHTML } from './serverInsertedHTML.tsx'
