export type Params = Record<string, string | undefined>

export interface CompiledPath {
  regexp: RegExp
  keys: { name: string; optional: boolean; splat: boolean }[]
}

const cache = new Map<string, CompiledPath>()

/**
 * Compile a route path like `/api/users/:id`, `/files/*` or `/posts/:slug?`
 * into a regular expression. Trailing slashes are ignored.
 */
export function compilePath(path: string): CompiledPath {
  let compiled = cache.get(path)
  if (compiled) return compiled
  const keys: CompiledPath['keys'] = []
  const segments = path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  let source = '^'
  for (const segment of segments) {
    if (segment === '*') {
      keys.push({ name: '*', optional: true, splat: true })
      source += '(?:/(.*))?'
    } else if (segment.startsWith(':')) {
      const optional = segment.endsWith('?')
      const name = segment.slice(1, optional ? -1 : undefined)
      keys.push({ name, optional, splat: false })
      source += optional ? '(?:/([^/]+))?' : '/([^/]+)'
    } else {
      source += '/' + segment.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    }
  }
  source += '/?$'
  compiled = { regexp: new RegExp(source === '^/?$' ? '^/?$' : source, 'i'), keys }
  cache.set(path, compiled)
  return compiled
}

export function matchPath(path: string, pathname: string): Params | undefined {
  const { regexp, keys } = compilePath(path)
  const match = regexp.exec(pathname)
  if (!match) return
  const params: Params = {}
  keys.forEach((key, index) => {
    const value = match[index + 1]
    if (value === undefined) return
    try {
      params[key.name] = decodeURIComponent(value)
    } catch {
      params[key.name] = value
    }
  })
  return params
}

/** Static segments first, then dynamic, then splats: the most specific route wins. */
export function scorePath(path: string) {
  return path.split('/').filter(Boolean).reduce((score, segment) => {
    if (segment === '*') return score + 1
    if (segment.startsWith(':')) return score + 2
    return score + 3
  }, 0)
}
