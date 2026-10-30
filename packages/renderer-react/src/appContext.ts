import React from 'react'
import { matchRoutes, useLocation } from 'react-router'
import { fetchServerLoader } from './dataFetcher.ts'
import { useRouteData } from './routeContext.ts'
import type { AppContextValue, ISelectedRoutes } from './types.ts'

export const AppContext = React.createContext<AppContextValue>({} as AppContextValue)

export function useAppData() {
  return React.useContext(AppContext)
}

/** Routes matched by the current location, outermost first. */
export function useSelectedRoutes(): ISelectedRoutes[] {
  const location = useLocation()
  const { clientRoutes } = useAppData()
  // `useLocation()` has no basename, so match without it
  return (matchRoutes(clientRoutes as any, location.pathname) as any) || []
}

/** Props of the innermost matched route (minus `element`). */
export function useRouteProps<T extends Record<string, any> = any>(): T {
  const currentRoute = useSelectedRoutes().slice(-1)
  const { element: _, ...props } = (currentRoute[0]?.route || {}) as any
  return props as T
}

/** Merged `serverLoader` data of the matched routes (falls back to fetching it without SSR). */
export function useServerLoaderData<T = any>(): { data: T | undefined } {
  const routes = useSelectedRoutes()
  const { serverLoaderData, basename, pluginManager } = useAppData()
  const ids = routes.map(route => route.route.id).join(',')
  const [data, setData] = React.useState<T | undefined>(() => {
    const ret = {} as any
    let has = false
    for (const route of routes) {
      const routeData = serverLoaderData[route.route.id]
      if (routeData) {
        Object.assign(ret, routeData)
        has = true
      }
    }
    return has ? ret : undefined
  })
  React.useEffect(() => {
    const ret = {} as any
    let has = false
    for (const route of routes) {
      const routeData = serverLoaderData[route.route.id]
      if (routeData) {
        Object.assign(ret, routeData)
        has = true
      }
    }
    if (has) {
      setData(ret)
      return
    }
    if (typeof window !== 'undefined' && window.__CORMI_LOADER_DATA__) return
    // SSR disabled: fetch the loader data on the client
    const pending = routes.filter(route => route.route.hasServerLoader)
    if (!pending.length) return
    let cancelled = false
    Promise.all(pending.map(route => fetchServerLoader({ id: route.route.id, basename, pluginManager })))
      .then((results) => {
        if (cancelled) return
        setData(Object.assign({}, ...results))
      })
      .catch(console.error)
    return () => { cancelled = true }
  }, [ids, serverLoaderData])
  return { data }
}

export function useClientLoaderData<T = any>(): { data: T | undefined } {
  const route = useRouteData()
  const appData = useAppData()
  return { data: route ? appData.clientLoaderData[route.route.id] : undefined }
}

/** `serverLoader` and `clientLoader` data of the current route, merged. */
export function useLoaderData<T = any>(): { data: T } {
  const serverLoaderData = useServerLoaderData()
  const clientLoaderData = useClientLoaderData()
  return {
    data: {
      ...serverLoaderData.data,
      ...clientLoaderData.data,
    } as T,
  }
}
