import type { IRoute } from '../types.ts'
import { assert } from '../utils/index.ts'

interface Memo {
  id: number
  ret: Record<string, IRoute>
}

/**
 * Flatten configured routes (`config.routes`) into `{ [id]: route }`.
 * `component` becomes `file` (resolved with `onResolveComponent`), `wrappers`
 * become intermediate layout routes.
 */
export function getConfigRoutes(opts: { routes: any[]; onResolveComponent?: (component: string) => string }) {
  const memo: Memo = { ret: {}, id: 1 }
  transformRoutes({ routes: opts.routes, parentId: undefined, memo, onResolveComponent: opts.onResolveComponent })
  return memo.ret
}

function transformRoutes(opts: { routes: any[]; parentId: string | undefined; memo: Memo; onResolveComponent?: Function }) {
  opts.routes.forEach((route) => {
    transformRoute({ route, parentId: opts.parentId, memo: opts.memo, onResolveComponent: opts.onResolveComponent })
  })
}

function transformRoute(opts: { route: any; parentId: string | undefined; memo: Memo; onResolveComponent?: Function }) {
  assert(!opts.route.children, 'children is not allowed in route props, use routes instead.')
  const id = String(opts.memo.id++)
  const { routes, component, wrappers, ...routeProps } = opts.route
  let absPath = opts.route.path
  if (absPath?.charAt(0) !== '/') {
    const parentAbsPath = opts.parentId
      ? opts.memo.ret[opts.parentId].absPath.replace(/\/+$/, '/')
      : '/'
    absPath = endsWithStar(parentAbsPath) ? parentAbsPath : ensureWithSlash(parentAbsPath, absPath)
  }
  opts.memo.ret[id] = {
    ...routeProps,
    path: opts.route.path,
    ...(component
      ? { file: opts.onResolveComponent ? opts.onResolveComponent(component) : component }
      : {}),
    parentId: opts.parentId,
    id,
  } as IRoute
  if (absPath) opts.memo.ret[id].absPath = absPath
  if (wrappers?.length) {
    let parentId = opts.parentId
    let path = opts.route.path
    const layout = opts.route.layout
    wrappers.forEach((wrapper: any) => {
      const { id } = transformRoute({
        route: {
          path,
          component: wrapper,
          isWrapper: true,
          ...(layout === false ? { layout: false } : {}),
        },
        parentId,
        memo: opts.memo,
        onResolveComponent: opts.onResolveComponent,
      })
      parentId = id
      path = endsWithStar(path) ? '*' : ''
    })
    opts.memo.ret[id].parentId = parentId
    opts.memo.ret[id].path = path
    // the real path of a wrapped route is empty; keep the original for layouts
    opts.memo.ret[id].originPath = opts.route.path
  }
  if (opts.route.routes) {
    transformRoutes({
      routes: opts.route.routes,
      parentId: id,
      memo: opts.memo,
      onResolveComponent: opts.onResolveComponent,
    })
  }
  return { id }
}

function endsWithStar(str: string) {
  return str?.endsWith('*')
}

function ensureWithSlash(left: string, right: string) {
  if (!right?.length || right === '/') return left
  return `${left.replace(/\/+$/, '')}/${right.replace(/^\/+/, '')}`
}
