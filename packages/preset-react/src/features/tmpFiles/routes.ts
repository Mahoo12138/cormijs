import { readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import {
  addParentRoute,
  getConfigRoutes,
  getConventionRoutes,
  type IRoute,
  lodash,
  resolveModule,
  winPath,
} from '@cormi/core'
import type { IApi } from '../../types.ts'
import { expandJSPaths, findFirst } from '../../utils/files.ts'
import { getModuleExports } from '../../utils/getModuleExports.ts'

const ROUTE_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.md', '.mdx']

function localPath(path: string) {
  return path.charAt(0) !== '.' ? `./${path}` : path
}

/** Resolve a route `component` / `file` to an absolute path. */
export function resolveRouteFile(api: IApi, file: string, basedir = getPagesBase(api)) {
  if (file.startsWith('@/')) file = join(api.paths.absSrcPath, file.slice(2))
  if (isAbsolute(file)) return winPath(resolveModule(file, basedir, ROUTE_EXTENSIONS))
  return winPath(resolveModule(localPath(file), basedir, ROUTE_EXTENSIONS))
}

export function getPagesBase(api: IApi) {
  const base = api.config.conventionRoutes?.base
  return base ? (isAbsolute(base) ? base : join(api.cwd, base)) : api.paths.absPagesPath
}

/** The route table of the app: `{ [id]: route }`, after layouts, `onPatchRoute` and `modifyRoutes`. */
export async function getRoutes(opts: { api: IApi }): Promise<Record<string, IRoute>> {
  const { api } = opts
  let routes: Record<string, IRoute>
  const isConfigRoutes = !!api.config.routes
  if (isConfigRoutes) {
    routes = getConfigRoutes({
      routes: lodash.cloneDeep(api.config.routes),
      onResolveComponent: component => resolveRouteFile(api, component, api.paths.absPagesPath),
    })
  } else {
    routes = getConventionRoutes({
      base: getPagesBase(api),
      exclude: api.config.conventionRoutes?.exclude,
      prefix: '',
    })
    // a 404 page catches every unmatched path
    for (const route of Object.values(routes)) {
      if (route.id === '404' && route.parentId === undefined) {
        route.path = '*'
        route.absPath = '/*'
      }
    }
  }

  // global layout: src/layouts/index.tsx
  const absLayoutPath = api.config.conventionLayout === false
    ? undefined
    : findFirst(expandJSPaths(join(api.paths.absSrcPath, 'layouts/index')))
  const layouts = await api.applyPlugins({
    key: 'addLayouts',
    initialValue: [
      absLayoutPath && {
        id: '@@/global-layout',
        file: absLayoutPath,
        test: (route: IRoute) => route.layout !== false,
      },
    ].filter(Boolean),
  })
  for (const layout of layouts) {
    addParentRoute({
      addToAll: true,
      target: {
        id: layout.id,
        path: '/',
        file: layout.file,
        parentId: undefined,
        absPath: '/',
        isLayout: true,
      },
      routes,
      test: layout.test,
    })
  }

  // collect the exports of route modules (serverLoader, clientLoader, routeProps)
  const pagesBase = getPagesBase(api)
  for (const id of Object.keys(routes)) {
    const route = routes[id]
    if (!route.file) continue
    let file = route.file
    if (!isAbsolute(file)) file = resolveRouteFile(api, file, pagesBase)
    route.__absFile = winPath(file)
    const isJSFile = /\.[jt]sx?$/.test(file)
    route.__isJSFile = isJSFile
    if (!isJSFile) continue
    const content = readFileSync(file, 'utf8')
    if (!route.isLayout) route.__content = content
    const exports = await getModuleExports({ file, content })
    route.__exports = exports
    if (exports.includes('serverLoader')) route.hasServerLoader = true
    if (exports.includes('metadataLoader')) route.hasMetadataLoader = true
    if (exports.includes('clientLoader') && api.config.clientLoader !== false) route.hasClientLoader = true
    if (exports.includes('routeProps') && !isConfigRoutes) route.hasRouteProps = true
  }

  for (const id of Object.keys(routes)) {
    await api.applyPlugins({ key: 'onPatchRoute', args: { route: routes[id] } })
  }

  return api.applyPlugins({ key: 'modifyRoutes', initialValue: routes })
}

/** API routes from `src/api`, e.g. `src/api/users/[id].ts` -> `/api/users/:id`. */
export function getApiRoutes(opts: { api: IApi }) {
  const base = opts.api.paths.absApiRoutesPath
  const routes = getConventionRoutes({ base, prefix: '' })
  const result: Record<string, IRoute & { __absFile: string }> = {}
  for (const route of Object.values(routes)) {
    // api routes are not nested: the full path is the absolute path
    const path = '/api' + route.absPath
      .replace(/\/+/g, '/')
      .replace(/\[\.\.\.([^\]]+)\]/g, '*')
      .replace(/\[([^\]]+)\]/g, ':$1')
      .replace(/\/$/, '')
    result[route.id] = {
      ...route,
      path: path || '/api',
      parentId: undefined,
      __absFile: winPath(join(base, route.file!)),
    }
  }
  return result
}

/** Route path ids that stay readable in chunk names. */
export function componentToChunkName(component: string, cwd = '/') {
  return winPath(component)
    .replace(new RegExp(`^${lodash.escapeRegExp(winPath(cwd).replace(/\/?$/, '/'))}`), '')
    .replace(/.+(node_modules\/)/, '$1')
    .replace(/^\.\//, '')
    .replace(/\//g, '__')
    .replace(/@/g, '_')
    .replace(/\.[jt]sx?$/, '')
    .replace(/^src__/, '')
    .replace(/\.\.__/g, '')
    .replace(/[[\]]/g, '')
    .replace(/^node_modules__/, 'nm__')
    .replace(/^\./, '')
    .replace(/^pages__/, 'p__')
}
