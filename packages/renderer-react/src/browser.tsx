import type { History, Update } from 'history'
import React, { useCallback, useEffect, useLayoutEffect, useState } from 'react'
import ReactDOM from 'react-dom/client'
import { matchRoutes, Router, useRoutes } from 'react-router'
import { AppContext, useAppData } from './appContext.ts'
import { fetchServerLoader } from './dataFetcher.ts'
import type { PluginManager } from './plugin.ts'
import { createClientRoutes } from './routes.tsx'
import type { IClientRoute, ILoaderData, IRouteComponents, IRoutesById } from './types.ts'

let root: ReactDOM.Root | null = null

/** The React root, e.g. for micro frontends that need to unmount the app. */
export function __getRoot() {
  return root
}

/** Re-render when `history` changes and dispatch the runtime hook `onRouteChange`. */
function BrowserRoutes(props: {
  routes: IRoutesById
  clientRoutes: IClientRoute[]
  pluginManager: PluginManager
  history: History
  basename: string
  children: React.ReactNode
}) {
  const { history } = props
  const [state, setState] = useState<Update>({
    action: history.action,
    location: history.location,
  })
  useLayoutEffect(() => history.listen(setState), [history])
  useLayoutEffect(() => {
    function onRouteChange(opts: Update & { isFirst?: boolean }) {
      props.pluginManager.applyPlugins({
        key: 'onRouteChange',
        type: 'event',
        args: {
          routes: props.routes,
          clientRoutes: props.clientRoutes,
          location: opts.location,
          action: opts.action,
          basename: props.basename,
          isFirst: Boolean(opts.isFirst),
        },
      })
    }
    onRouteChange({ location: state.location, action: state.action, isFirst: true })
    return history.listen(onRouteChange)
  }, [history, props.routes, props.clientRoutes])
  return (
    <Router navigator={history} location={state.location} navigationType={state.action as any} basename={props.basename}>
      {props.children}
    </Router>
  )
}

export function Routes() {
  const { clientRoutes } = useAppData()
  return useRoutes(clientRoutes as any)
}

export interface RenderClientOpts {
  /** id of the DOM element to mount into (default `root`) */
  mountElementId?: string
  rootElement?: HTMLElement
  routes: IRoutesById
  routeComponents: IRouteComponents
  pluginManager: PluginManager
  basename?: string
  loadingComponent?: React.ComponentType
  history: History
  /** hydrate server-rendered markup */
  hydrate?: boolean
  /** wrap route components in `<Suspense>` (default true) */
  useStream?: boolean
  /** return the root component instead of rendering it (for tests) */
  components?: boolean
  reactRouter5Compat?: boolean
  publicPath?: string
  runtimePublicPath?: boolean
  /** called once the app has rendered */
  callback?: () => void
}

/**
 * Providers applied around the router, from the innermost to the outermost.
 * Each key is a runtime hook of `modify` type receiving the current element.
 */
export const CLIENT_RENDER_PROVIDERS = [
  'innerProvider',
  'i18nProvider',
  'accessProvider',
  'dataflowProvider',
  'outerProvider',
  'rootContainer',
]

export function applyProviders(container: React.ReactElement, pluginManager: PluginManager, args: Record<string, any>) {
  for (const key of CLIENT_RENDER_PROVIDERS) {
    container = pluginManager.applyPlugins({
      type: 'modify',
      key,
      initialValue: container,
      args: { ...args, plugin: pluginManager },
    })
  }
  return container
}

export function getBrowser(opts: RenderClientOpts, routesElement: React.ReactElement) {
  const basename = opts.basename || '/'
  const clientRoutes = createClientRoutes({
    routesById: opts.routes,
    routeComponents: opts.routeComponents,
    loadingComponent: opts.loadingComponent,
    reactRouter5Compat: opts.reactRouter5Compat,
    useStream: opts.useStream,
  })
  opts.pluginManager.applyPlugins({
    key: 'patchClientRoutes',
    type: 'event',
    args: { routes: clientRoutes },
  })

  const rootContainer = applyProviders(
    <BrowserRoutes
      basename={basename}
      pluginManager={opts.pluginManager}
      routes={opts.routes}
      clientRoutes={clientRoutes}
      history={opts.history}
    >
      {routesElement}
    </BrowserRoutes>,
    opts.pluginManager,
    { routes: opts.routes, history: opts.history },
  )

  return function Browser() {
    const [clientLoaderData, setClientLoaderData] = useState<ILoaderData>({})
    const [serverLoaderData, setServerLoaderData] = useState<ILoaderData>(
      () => window.__CORMI_LOADER_DATA__ || {},
    )

    const handleRouteChange = useCallback((pathname: string, isFirst?: boolean) => {
      const matchedRouteIds = (matchRoutes(clientRoutes as any, pathname, basename) || [])
        .map(match => (match.route as any).id as string)
        .filter(Boolean)
      for (const id of matchedRouteIds) {
        const route = opts.routes[id]
        // preload the lazy component (`React.lazy` keeps its factory in `_payload`)
        const lazyCtor = opts.routeComponents[id]?._payload?._result
        if (typeof lazyCtor === 'function') lazyCtor()

        const clientLoader = route?.clientLoader
        const hasServerLoader = route?.hasServerLoader
        const loadServerData = () => fetchServerLoader({ id, basename, pluginManager: opts.pluginManager }).then((data) => {
          // inside a transition, so that hydration is not interrupted
          React.startTransition(() => setServerLoaderData(d => ({ ...d, [id]: data })))
          return data
        })
        if (!isFirst && hasServerLoader && !clientLoader) {
          loadServerData().catch(console.error)
        }
        if (clientLoader && !clientLoaderData[id]) {
          clientLoader({ serverLoader: loadServerData })
            .then(data => setClientLoaderData(d => ({ ...d, [id]: data })))
            .catch(console.error)
        }
      }
    }, [clientLoaderData])

    useEffect(() => {
      handleRouteChange(opts.history.location.pathname, true)
      return opts.history.listen(e => handleRouteChange(e.location.pathname))
    }, [])

    useLayoutEffect(() => {
      opts.callback?.()
    }, [])

    return (
      <AppContext.Provider
        value={{
          routes: opts.routes,
          routeComponents: opts.routeComponents,
          clientRoutes,
          pluginManager: opts.pluginManager,
          rootElement: opts.rootElement,
          basename,
          clientLoaderData,
          serverLoaderData,
          preloadRoute: handleRouteChange,
          history: opts.history,
        }}
      >
        {rootContainer}
      </AppContext.Provider>
    )
  }
}

/** Render (or hydrate) the app into `rootElement`. */
export function renderClient(opts: RenderClientOpts) {
  const rootElement = opts.rootElement || document.getElementById(opts.mountElementId || 'root')!
  const Browser = getBrowser({ ...opts, rootElement }, <Routes />)
  if (opts.components) return Browser
  if (opts.hydrate) {
    root = ReactDOM.hydrateRoot(rootElement, <Browser />)
    return
  }
  root = ReactDOM.createRoot(rootElement)
  root.render(<Browser />)
}
