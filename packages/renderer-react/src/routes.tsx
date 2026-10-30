import React from 'react'
import { generatePath, Navigate, Outlet, useLocation, useParams } from 'react-router'
import { useAppData, useRouteProps } from './appContext.ts'
import { RouteContext, useRouteData } from './routeContext.ts'
import type { IClientRoute, IRoute, IRouteComponents, IRoutesById } from './types.ts'

export interface CreateClientRoutesOptions {
  routesById: IRoutesById
  routeComponents: IRouteComponents
  parentId?: string
  loadingComponent?: React.ComponentType
  reactRouter5Compat?: boolean
  /** wrap route components with `<Suspense>` (needed by `React.lazy`) */
  useStream?: boolean
}

/** Turn the flat `routesById` map into the nested route objects of react-router. */
export function createClientRoutes(opts: CreateClientRoutesOptions): IClientRoute[] {
  const { routesById, parentId, routeComponents, useStream = true } = opts
  return Object.keys(routesById)
    .filter(id => routesById[id].parentId === parentId)
    .map((id) => {
      const route = createClientRoute({
        route: routesById[id],
        routeComponent: routeComponents[id],
        loadingComponent: opts.loadingComponent,
        reactRouter5Compat: opts.reactRouter5Compat,
        hasChildren: opts.reactRouter5Compat
          ? Object.keys(routesById).some(rid => routesById[rid].parentId === id)
          : undefined,
        useStream,
      })
      const children = createClientRoutes({ ...opts, parentId: route.id })
      if (children.length > 0) {
        route.children = children
        route.routes = children
      }
      return route
    })
}

function NavigateWithParams(props: { to: string }) {
  const params = useParams()
  let to = generatePath(props.to, params)
  const routeProps = useRouteProps()
  const location = useLocation()
  if (routeProps?.keepQuery) to += location.search + location.hash
  return <Navigate replace {...props} to={to} />
}

function DefaultLoading() {
  return <div />
}

function createClientRoute(opts: {
  route: IRoute
  routeComponent: any
  loadingComponent?: React.ComponentType
  hasChildren?: boolean
  reactRouter5Compat?: boolean
  useStream?: boolean
}): IClientRoute {
  const { route, useStream = true } = opts
  const { redirect, ...props } = route
  const Remote = opts.reactRouter5Compat ? RemoteComponentReactRouter5 : RemoteComponent
  return {
    element: redirect
      ? <NavigateWithParams to={redirect} />
      : (
          <RouteContext.Provider value={{ route: opts.route }}>
            <Remote
              loader={opts.routeComponent}
              loadingComponent={opts.loadingComponent || DefaultLoading}
              hasChildren={opts.hasChildren}
              useStream={useStream}
            />
          </RouteContext.Provider>
        ),
    ...props,
  } as IClientRoute
}

interface RemoteProps {
  loader: any
  loadingComponent: React.ComponentType
  hasChildren?: boolean
  useStream?: boolean
}

function RemoteComponent(props: RemoteProps) {
  const Component = props.loader
  if (!Component) return <Outlet />
  return props.useStream
    ? (
        <React.Suspense fallback={<props.loadingComponent />}>
          <Component />
        </React.Suspense>
      )
    : <Component />
}

/** Route components receive `location`, `match`, `history`, ... like react-router 5. */
function RemoteComponentReactRouter5(props: RemoteProps) {
  const { route } = useRouteData()
  const { history, clientRoutes } = useAppData()
  const params = useParams()
  const match = {
    params,
    isExact: true,
    path: route.path,
    url: history?.location.pathname,
  }
  const Component = props.loader
  if (!Component) return <Outlet />
  const componentProps = {
    location: history?.location,
    match,
    history,
    params,
    route,
    routes: clientRoutes,
  }
  const element = <Component {...componentProps}>{props.hasChildren && <Outlet />}</Component>
  return props.useStream
    ? <React.Suspense fallback={<props.loadingComponent />}>{element}</React.Suspense>
    : element
}
