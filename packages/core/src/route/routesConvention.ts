import { lstatSync, readdirSync } from 'node:fs'
import { extname, relative, resolve } from 'node:path'
import { isDirectory, winPath } from '../utils/path.ts'
import { defineRoutes, type DefineRoute } from './defineRoutes.ts'
import { byLongestFirst, createRouteId, isRouteModuleFile } from './utils.ts'

/**
 * Convention routes from a pages directory (`opts.base`):
 *
 * - `index.tsx` -> `/`, `users/index.tsx` -> `/users`
 * - `users.tsx` + `users/foo.tsx` -> `/users` layout with nested `foo`
 * - `$id.tsx` -> `:id`, `$.tsx` -> `*`, `not.nested.tsx` -> `not/nested`
 */
export function getConventionRoutes(opts: { base: string; prefix?: string; exclude?: RegExp[] }) {
  const files: Record<string, string> = {}
  if (!isDirectory(opts.base)) return {}
  visitFiles({
    dir: opts.base,
    visitor: (file) => {
      const routeId = createRouteId(file)
      if (isRouteModuleFile({ file: winPath(file), exclude: opts.exclude })) {
        files[routeId] = winPath(file)
      }
    },
  })

  const routeIds = Object.keys(files).sort(byLongestFirst)
  const parentToChildrenMap = new Map<string, string[]>()
  routeIds.forEach((id) => {
    const prefix = `${id}/`
    routeIds
      .filter(childId => childId.startsWith(prefix) && childId !== id)
      .forEach((childId) => {
        if (!parentToChildrenMap.has(id)) parentToChildrenMap.set(id, [])
        parentToChildrenMap.get(id)!.push(childId)
      })
  })

  function defineNestedRoutes(defineRoute: DefineRoute, parentId?: string) {
    const childRouteIds = parentId ? parentToChildrenMap.get(parentId) || [] : routeIds
    // longest ids first: a nested route is first defined at an outer level,
    // then overwritten when its actual parent defines its children
    for (const routeId of childRouteIds) {
      const routePath = createRoutePath(parentId ? routeId.slice(parentId.length + 1) : routeId)
      defineRoute({
        path: routePath,
        file: `${opts.prefix || ''}${files[routeId]}`,
        children() {
          defineNestedRoutes(defineRoute, routeId)
        },
      })
    }
  }

  return defineRoutes(defineNestedRoutes)
}

function visitFiles(opts: { dir: string; visitor: (file: string) => void; baseDir?: string }): void {
  opts.baseDir = opts.baseDir || opts.dir
  for (const filename of readdirSync(opts.dir)) {
    const file = resolve(opts.dir, filename)
    const stat = lstatSync(file)
    if (stat.isDirectory()) {
      visitFiles({ ...opts, dir: file })
    } else if (stat.isFile() && ['.tsx', '.ts', '.js', '.jsx', '.md', '.mdx'].includes(extname(file))) {
      opts.visitor(relative(opts.baseDir, file))
    }
  }
}

export function createRoutePath(routeId: string): string {
  let path = routeId
    // routes/$ -> routes/*
    .replace(/^\$$/, '*')
    // routes/docs.$ -> routes/docs/*, routes/docs/$ -> routes/docs/*
    .replace(/(\/|\.)\$$/, '/*')
    // routes/$user -> routes/:user
    .replace(/\$/g, ':')
    // routes/not.nested -> routes/not/nested
    .replace(/\./g, '/')

  // only replace two `index` in the end of path: /index/index -> /index
  path = /(^|\/)index\/index$/.test(path) ? path.replace(/\/index$/, '') : path
  // e/index -> e, index -> '', e/:index -> e/:index
  path = /\b\/?(?<!:)index$/.test(path) ? path.replace(/\/?index$/, '') : path
  path = /\b\/?README$/.test(path) ? path.replace(/\/?README$/, '') : path

  return path
}
