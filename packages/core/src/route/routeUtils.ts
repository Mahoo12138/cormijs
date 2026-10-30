import type { IRoute } from '../types.ts'

/**
 * Insert `target` as the parent of a route (`id`) or of every top-level route
 * (`addToAll`) that passes `test`. Used to apply global layouts.
 */
export function addParentRoute(opts: {
  id?: string
  addToAll?: boolean
  target: IRoute
  routes: Record<string, IRoute>
  test?: (route: IRoute) => boolean
}) {
  if (opts.addToAll) {
    for (const id of Object.keys(opts.routes)) {
      if (opts.routes[id].parentId === undefined && (!opts.test || opts.test(opts.routes[id]))) {
        opts.routes[id].parentId = opts.target.id
      }
    }
  } else if (opts.id) {
    if (!opts.test || opts.test(opts.routes[opts.id])) {
      opts.routes[opts.id].parentId = opts.target.id
    }
  } else {
    throw new Error(`addParentRoute failed, opts.addToAll or opts.id must be supplied.`)
  }
  opts.routes[opts.target.id] = opts.target
}
