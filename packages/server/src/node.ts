import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'

export type WebHandler = (request: Request) => Promise<Response | undefined> | Response | undefined

export type NodeMiddleware = (req: IncomingMessage, res: ServerResponse, next: (error?: any) => void) => void

/** Build a Web `Request` from a node request (honoring `X-Forwarded-*` headers). */
export function toWebRequest(req: IncomingMessage & { originalUrl?: string }): Request {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) value.forEach(item => headers.append(key, item))
    else headers.set(key, value)
  }
  const protocol = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]
    || ((req.socket as any)?.encrypted ? 'https' : 'http')
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host || 'localhost'
  const url = new URL(req.originalUrl ?? req.url ?? '/', `${protocol}://${host}`)
  const method = req.method || 'GET'
  const init: RequestInit & { duplex?: 'half' } = { method, headers }
  if (method !== 'GET' && method !== 'HEAD') {
    init.body = Readable.toWeb(req) as any
    init.duplex = 'half'
  }
  return new Request(url, init)
}

/** Write a Web `Response` to a node response. */
export async function sendWebResponse(res: ServerResponse, response: Response) {
  res.statusCode = response.status
  if (response.statusText) res.statusMessage = response.statusText
  const cookies = response.headers.getSetCookie?.() ?? []
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return
    res.setHeader(key, value)
  })
  if (cookies.length) res.setHeader('Set-Cookie', cookies)
  if (!response.body) {
    res.end()
    return
  }
  const reader = response.body.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      res.write(value)
    }
  } finally {
    res.end()
  }
}

/** Adapt Web handlers into a connect / express middleware; `undefined` responses fall through. */
export function createMiddleware(...handlers: WebHandler[]): NodeMiddleware {
  return (req, res, next) => {
    const request = toWebRequest(req)
    ;(async () => {
      for (const handler of handlers) {
        const response = await handler(request)
        if (response) {
          await sendWebResponse(res, response)
          return
        }
      }
      next()
    })().catch(next)
  }
}
