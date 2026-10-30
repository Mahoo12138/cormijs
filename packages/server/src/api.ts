import { matchPath, type Params, scorePath } from './match.ts'

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const

export type HttpMethod = typeof HTTP_METHODS[number]

export interface ApiContext {
  params: Params
}

/** A Web-standard handler: `export async function GET(request, { params }) {}` */
export type ApiHandler = (request: Request, context: ApiContext) => any

/** umi-style handler: `export default function (req, res) {}` */
export type LegacyApiHandler = (req: CormiApiRequest, res: CormiApiResponse) => any

export interface ApiRouteModule {
  default?: LegacyApiHandler
  [method: string]: any
}

export interface ApiRoute {
  id: string
  /** URL path, e.g. `/api/users/:id` */
  path: string
  load: () => Promise<ApiRouteModule>
}

function parseQuery(search: URLSearchParams) {
  const query: Record<string, string | string[]> = {}
  for (const [key, value] of search) {
    const existing = query[key]
    if (existing === undefined) query[key] = value
    else if (Array.isArray(existing)) existing.push(value)
    else query[key] = [existing, value]
  }
  return query
}

/** umi's `UmiApiRequest`, backed by a Web `Request`. */
export class CormiApiRequest {
  private _body: any = undefined
  readonly url: URL

  constructor(public readonly request: Request, public readonly params: Params) {
    this.url = new URL(request.url)
  }

  get method() {
    return this.request.method
  }

  get headers() {
    return Object.fromEntries(this.request.headers)
  }

  get query() {
    return parseQuery(this.url.searchParams)
  }

  get pathName() {
    return this.url.pathname
  }

  get cookies() {
    const cookie = this.request.headers.get('cookie')
    if (!cookie) return {}
    return Object.fromEntries(cookie.split(';').map((part) => {
      const index = part.indexOf('=')
      return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())]
    }))
  }

  get body() {
    return this._body
  }

  /** Parse the body by content type (JSON, urlencoded, multipart, text). */
  async readBody() {
    if (this._body !== undefined) return this._body
    if (this.method === 'GET' || this.method === 'HEAD' || !this.request.body) return this._body = null
    const type = this.request.headers.get('content-type')?.split(';')[0].trim()
    const clone = this.request.clone()
    if (type === 'application/json') {
      const text = await clone.text()
      try {
        this._body = text ? JSON.parse(text) : null
      } catch {
        this._body = text
      }
    } else if (type === 'application/x-www-form-urlencoded' || type === 'multipart/form-data') {
      const form = await clone.formData()
      const body: Record<string, any> = {}
      for (const [key, value] of form) {
        body[key] = typeof value === 'string'
          ? value
          : { fileName: value.name, contentType: value.type, data: Buffer.from(await value.arrayBuffer()) }
      }
      this._body = body
    } else {
      this._body = await clone.text()
    }
    return this._body
  }
}

/** umi's `UmiApiResponse`, collecting the response into a Web `Response`. */
export class CormiApiResponse {
  statusCode = 200
  headers = new Headers()
  ended = false
  private body: BodyInit | null = null
  private resolve!: () => void
  readonly finished = new Promise<void>(resolve => this.resolve = resolve)

  status(statusCode: number) {
    this.statusCode = statusCode
    return this
  }

  header(key: string, value: string) {
    this.headers.set(key, value)
    return this
  }

  setHeader(key: string, value: string) {
    return this.header(key, value)
  }

  setCookie(key: string, value: string, options = 'path=/') {
    this.headers.append('Set-Cookie', `${key}=${encodeURIComponent(value)}; ${options}`)
    return this
  }

  redirect(location: string, status = 302) {
    this.statusCode = status
    this.headers.set('Location', location)
    return this.end()
  }

  end(data?: BodyInit | null) {
    if (this.ended) return this
    this.ended = true
    this.body = data ?? null
    this.resolve()
    return this
  }

  send(data: any) {
    if (data === undefined || data === null) return this.end()
    if (typeof data === 'object' && !(data instanceof Uint8Array) && !(data instanceof ArrayBuffer) && !(data instanceof Blob) && !(data instanceof ReadableStream)) {
      return this.json(data)
    }
    if (typeof data === 'string' && !this.headers.has('Content-Type')) {
      this.headers.set('Content-Type', 'text/html; charset=utf-8')
    }
    return this.end(data)
  }

  text(data: string) {
    this.headers.set('Content-Type', 'text/plain; charset=utf-8')
    return this.end(data)
  }

  html(data: string) {
    this.headers.set('Content-Type', 'text/html; charset=utf-8')
    return this.end(data)
  }

  json(data: any) {
    this.headers.set('Content-Type', 'application/json; charset=utf-8')
    return this.end(JSON.stringify(data))
  }

  toResponse() {
    const nullBody = [101, 204, 205, 304].includes(this.statusCode)
    return new Response(nullBody ? null : this.body, { status: this.statusCode, headers: this.headers })
  }
}

/** Turn whatever a Web-style handler returned into a `Response`. */
export function toResponse(value: any): Response {
  if (value instanceof Response) return value
  if (value === undefined || value === null) return new Response(null, { status: 204 })
  if (typeof value === 'string') {
    return new Response(value, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
  }
  return Response.json(value)
}

export function sortApiRoutes(routes: ApiRoute[]) {
  return [...routes].sort((a, b) => scorePath(b.path) - scorePath(a.path))
}

export function matchApiRoute(routes: ApiRoute[], pathname: string) {
  for (const route of sortApiRoutes(routes)) {
    const params = matchPath(route.path, pathname)
    if (params) return { route, params }
  }
}

/**
 * Create a handler for file-system API routes. Resolves to `undefined` when no
 * route matches the request, so the caller can fall through.
 */
export function createApiHandler(opts: {
  routes: ApiRoute[] | (() => ApiRoute[])
  /** strip this prefix (the router basename) before matching */
  basename?: string
  onError?: (error: unknown, request: Request) => void
}) {
  return async (request: Request): Promise<Response | undefined> => {
    const routes = typeof opts.routes === 'function' ? opts.routes() : opts.routes
    let pathname = new URL(request.url).pathname
    const base = opts.basename?.replace(/\/+$/, '')
    if (base && pathname.startsWith(base + '/')) pathname = pathname.slice(base.length)
    const matched = matchApiRoute(routes, pathname)
    if (!matched) return
    const { route, params } = matched
    try {
      const mod = await route.load()
      const method = request.method.toUpperCase()
      const handler: ApiHandler | undefined = mod[method] ?? (method === 'HEAD' ? mod.GET : undefined)
      if (typeof handler === 'function') {
        return toResponse(await handler(request, { params }))
      }
      if (typeof mod.default === 'function') {
        const req = new CormiApiRequest(request, params)
        const res = new CormiApiResponse()
        await req.readBody()
        const result = await mod.default(req, res)
        if (!res.ended && result !== undefined) {
          return result instanceof Response ? result : toResponse(result)
        }
        await res.finished
        return res.toResponse()
      }
      const allowed = HTTP_METHODS.filter(name => typeof mod[name] === 'function')
      return new Response('Method Not Allowed', { status: 405, headers: { Allow: allowed.join(', ') } })
    } catch (error) {
      opts.onError?.(error, request)
      return new Response('Internal Server Error', { status: 500 })
    }
  }
}
