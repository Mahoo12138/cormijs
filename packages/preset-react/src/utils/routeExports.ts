import { readFileSync } from 'node:fs'
import { generate } from '@babel/generator'
import { parse } from '@babel/parser'
import * as babelTraverse from '@babel/traverse'
import type { NodePath, Visitor } from '@babel/traverse'
import type * as t from '@babel/types'
import { deadCodeElimination, findReferencedIdentifiers } from 'babel-dead-code-elimination'
import type { Plugin } from 'vite'

// `@babel/traverse` is CommonJS: its default export may be wrapped once more
const traverse = ((babelTraverse as any).default?.default ?? (babelTraverse as any).default) as (ast: t.Node, visitor: Visitor) => void

export const SERVER_ONLY_EXPORTS = ['serverLoader', 'metadataLoader']

export const ROUTE_PROPS_QUERY = 'cormi-route-props'

function exportedNames(path: NodePath<t.ExportNamedDeclaration>): string[] {
  const { declaration, specifiers } = path.node
  const names: string[] = []
  if (declaration) {
    if ('id' in declaration && declaration.id && declaration.id.type === 'Identifier') {
      names.push(declaration.id.name)
    } else if (declaration.type === 'VariableDeclaration') {
      for (const decl of declaration.declarations) {
        if (decl.id.type === 'Identifier') names.push(decl.id.name)
      }
    }
  }
  for (const specifier of specifiers) {
    if (specifier.exported.type === 'Identifier') names.push(specifier.exported.name)
    else names.push(specifier.exported.value)
  }
  return names
}

/**
 * Remove (or keep only) some exports of a module, then the code that only
 * they referenced — including imports — like Remix's route module splitting.
 */
export function transformExports(code: string, opts: { remove?: string[]; keep?: string[]; filename?: string }) {
  const ast = parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx', 'decorators-legacy'],
    sourceFilename: opts.filename,
  })
  const referenced = findReferencedIdentifiers(ast)
  const shouldRemove = (name: string) => opts.keep ? !opts.keep.includes(name) : !!opts.remove?.includes(name)
  let changed = false
  traverse(ast, {
    ExportNamedDeclaration(path) {
      const { declaration } = path.node
      if (declaration?.type === 'VariableDeclaration') {
        declaration.declarations = declaration.declarations.filter((decl) => {
          const remove = decl.id.type === 'Identifier' && shouldRemove(decl.id.name)
          if (remove) changed = true
          return !remove
        })
        if (!declaration.declarations.length) path.remove()
        return
      }
      if (declaration) {
        if (exportedNames(path).some(shouldRemove)) {
          changed = true
          path.remove()
        }
        return
      }
      const specifiers = path.node.specifiers.filter((specifier) => {
        const name = specifier.exported.type === 'Identifier' ? specifier.exported.name : specifier.exported.value
        const remove = shouldRemove(name)
        if (remove) changed = true
        return !remove
      })
      if (!specifiers.length) {
        path.remove()
      } else {
        path.node.specifiers = specifiers
      }
    },
    ExportDefaultDeclaration(path) {
      if (shouldRemove('default')) {
        changed = true
        path.remove()
      }
    },
    ExportAllDeclaration(path) {
      if (opts.keep) {
        changed = true
        path.remove()
      }
    },
  })
  if (!changed) return
  deadCodeElimination(ast, referenced)
  return generate(ast, { sourceMaps: true, sourceFileName: opts.filename }, code)
}

/**
 * - client builds: strip `serverLoader` / `metadataLoader` from route modules,
 *   so that server code never reaches the browser
 * - `<route>?cormi-route-props`: a module with only the `routeProps` export
 */
export function routeExportsPlugin(opts: { isRouteFile: (file: string) => boolean }): Plugin {
  return {
    name: 'cormi:route-exports',
    enforce: 'pre',
    load(id) {
      const [file, query] = id.split('?')
      if (!query?.split('&').includes(ROUTE_PROPS_QUERY)) return
      const code = readFileSync(file, 'utf8')
      const result = transformExports(code, { keep: ['routeProps'], filename: file })
      return result ? { code: result.code, map: result.map as any } : code
    },
    transform(code, id, options) {
      if (options?.ssr) return
      const [file, query] = id.split('?')
      if (query?.includes(ROUTE_PROPS_QUERY)) return
      if (!/\.[jt]sx?$/.test(file) || !opts.isRouteFile(file)) return
      if (!SERVER_ONLY_EXPORTS.some(name => code.includes(name))) return
      const result = transformExports(code, { remove: SERVER_ONLY_EXPORTS, filename: file })
      if (result) return { code: result.code, map: result.map as any }
    },
  }
}
