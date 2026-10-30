import type { RouteMatch, RouteObject } from 'react-router'
import type { PluginManager } from './plugin.ts'

declare global {
  interface Window {
    __CORMI_LOADER_DATA__?: Record<string, any>
    __CORMI_ROUTE_PREFETCH__?: { defaultPrefetch?: string; defaultPrefetchTimeout?: number }
    __cormiServerLoaderPath__?: string
  }
}

export interface ServerLoaderArgs {
  request: Request
  params: Record<string, string | undefined>
}

export type ServerLoader<T = any> = (args: ServerLoaderArgs) => T | Promise<T>

export interface ClientLoaderArgs {
  /** fetch the data of the route's `serverLoader` through `/__serverLoader` */
  serverLoader: () => Promise<any>
}

export type ClientLoader<T = any> = ((args: ClientLoaderArgs) => Promise<T>) & {
  hydrate?: boolean
}

export interface IRoute {
  id: string
  path?: string
  index?: boolean
  parentId?: string
  redirect?: string
  clientLoader?: ClientLoader
  hasServerLoader?: boolean
  [key: string]: any
}

export interface IClientRoute extends IRoute {
  element: React.ReactNode
  children?: IClientRoute[]
  /** compatible with layouts expecting `routes` (e.g. pro-layout) */
  routes?: IClientRoute[]
}

export interface ISelectedRoute extends IRoute, Omit<RouteObject, 'id' | 'children' | 'path' | 'index'> {}

export interface ISelectedRoutes extends Omit<RouteMatch, 'route'> {
  route: ISelectedRoute
}

export type IRoutesById = Record<string, IRoute>

export type IRouteComponents = Record<string, any>

export type ILoaderData = Record<string, any>

export interface RouteChangeArgs {
  routes: IRoutesById
  clientRoutes: IClientRoute[]
  location: Location | import('history').Location
  action: string
  basename: string
  isFirst: boolean
}

export interface AppContextValue {
  routes: IRoutesById
  routeComponents: IRouteComponents
  clientRoutes: IClientRoute[]
  pluginManager: PluginManager
  rootElement?: HTMLElement
  basename?: string
  clientLoaderData: ILoaderData
  serverLoaderData: ILoaderData
  preloadRoute?: (to: string) => void
  history?: any
}
