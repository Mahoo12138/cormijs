import type { IRoute } from '../types.ts'
import { createRouteId } from './utils.ts'

export interface DefineRouteOptions {
  path: string
  file: string
  options?: {}
  children?: () => void
}

export type DefineRoute = (opts: DefineRouteOptions) => void

export function defineRoutes(callback: (defineRoute: DefineRoute) => void) {
  const routes: Record<string, IRoute> = Object.create(null)
  const parentRoutes: IRoute[] = []
  const defineRoute: DefineRoute = (opts) => {
    opts.options = opts.options || {}
    const parentRoute = parentRoutes.length > 0 ? parentRoutes[parentRoutes.length - 1] : null
    const parentId = parentRoute?.id
    const parentAbsPath = parentRoute?.absPath
    const absPath = [parentAbsPath, opts.path].join('/')
    const route: IRoute = {
      // 1. root index route path: '/'
      // 2. nested children route path
      //    - dir
      //      - some.ts  -> 'some'
      //      - index.ts -> ''
      //    - dir.tsx    -> '/dir'
      path: absPath === '/' ? '/' : opts.path,
      id: createRouteId(opts.file),
      parentId,
      file: opts.file,
      absPath,
    }
    routes[route.id] = route
    if (opts.children) {
      parentRoutes.push(route)
      opts.children()
      parentRoutes.pop()
    }
  }
  callback(defineRoute)
  return routes
}
