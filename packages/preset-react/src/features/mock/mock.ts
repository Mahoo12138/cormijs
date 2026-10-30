import { join, resolve } from 'node:path'
import { loadModule, unwrapDefault } from '@cormi/core'
import { matchPath } from '@cormi/server'
import express, { type RequestHandler } from 'express'
import pc from 'picocolors'
import { glob } from 'tinyglobby'
import type { IApi } from '../../types.ts'
import { watch } from '../../utils/watch.ts'

export const VALID_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
export const DEFAULT_METHOD = 'GET'
export const MOCK_FILE_GLOB = 'mock/**/*.[jt]s'

export interface IMock {
  method: string
  path: string
  handler: Function | Record<string, any> | any[]
  file?: string
}

export function parseKey(key: string) {
  const spliced = key.trim().split(/\s+/)
  if (spliced.length === 1) return { method: DEFAULT_METHOD, path: key }
  const [method, path] = spliced
  const upperCaseMethod = method.toUpperCase()
  if (!VALID_METHODS.includes(upperCaseMethod)) throw new Error(`method ${method} is not supported`)
  if (!path) throw new Error(`${key}, path is undefined`)
  return { method: upperCaseMethod, path }
}

/** Load `mock/**` (plus `mock.include`) into `{ 'METHOD /path': mock }`. */
export async function getMockData(opts: { cwd: string; mockConfig: { exclude?: string[]; include?: string[] } }) {
  const files = new Set<string>()
  const dependencies = new Set<string>()
  for (const pattern of [MOCK_FILE_GLOB, ...(opts.mockConfig.include || [])]) {
    for (const file of await glob(pattern, { cwd: opts.cwd, ignore: ['**/*.d.ts', ...(opts.mockConfig.exclude || [])] })) {
      files.add(file)
    }
  }
  const data: Record<string, IMock> = {}
  const relativeName = (file: string) => pc.yellow(file.replace(opts.cwd.endsWith('/') ? opts.cwd : `${opts.cwd}/`, ''))
  for (const file of [...files].sort()) {
    const mockFile = join(opts.cwd, file)
    let exports: any
    try {
      const loaded = await loadModule(mockFile)
      exports = unwrapDefault(loaded.exports)
      loaded.dependencies.forEach(dep => dependencies.add(dep))
    } catch (cause) {
      throw new Error(`Mock file ${mockFile} parse failed.\n${(cause as Error).message}`, { cause })
    }
    for (const key of Object.keys(exports ?? {})) {
      const { method, path } = parseKey(key)
      const handler = exports[key]
      if (!(typeof handler === 'function' || Array.isArray(handler) || (handler && typeof handler === 'object'))) {
        throw new Error(`Mock handler must be function or array or object, but got ${typeof handler} for ${method} in ${mockFile}`)
      }
      const id = `${method} ${path}`
      if (data[id]) {
        console.warn(`${id} is duplicated in ${relativeName(mockFile)} and ${relativeName(data[id].file!)}`)
      }
      data[id] = { method, path, handler, file: mockFile }
    }
  }
  Object.defineProperty(data, Symbol.for('cormi.dependencies'), { value: [...dependencies] })
  return data
}

/** express middleware serving the mock data; `context.mockData` can be swapped at any time. */
export function createMockMiddleware(opts: { context: { mockData: Record<string, IMock> | null } }): RequestHandler {
  const json = express.json({ limit: '5mb', strict: false })
  const urlencoded = express.urlencoded({ limit: '5mb', extended: true })
  return (req, res, next) => {
    const method = req.method.toUpperCase()
    for (const mock of Object.values(opts.context.mockData ?? {})) {
      if (mock.method !== method) continue
      const params = matchPath(mock.path, req.path)
      if (!params) continue
      if (typeof mock.handler !== 'function') {
        res.status(200).json(mock.handler)
        return
      }
      const handler = mock.handler
      Object.defineProperty(req, 'params', { value: params, configurable: true, writable: true })
      if (method === 'GET' || method === 'HEAD') {
        handler(req, res, next)
        return
      }
      json(req, res, () => urlencoded(req, res, () => handler(req, res, next)))
      return
    }
    next()
  }
}

export default (api: IApi) => {
  api.describe({
    key: 'mock',
    config: {
      schema: ({ zod }) => zod.object({
        exclude: zod.array(zod.string()).describe('exclude files not parse mock'),
        include: zod.array(zod.string()),
      }).partial(),
    },
    enableBy() {
      // only enabled in dev
      if (api.name !== 'dev') return false
      return process.env.MOCK !== 'none'
    },
  })

  const context: { mockData: Record<string, IMock> | null } = { mockData: null }

  async function updateMockData(onSuccess?: () => void) {
    try {
      context.mockData = await getMockData({ cwd: api.cwd, mockConfig: api.config.mock || {} })
      onSuccess?.()
    } catch (error) {
      api.logger.error(error)
    }
  }

  api.onStart(() => {
    const { include = [] } = api.config.mock || {}
    watch(api.ctx, ['mock', ...include].map(pattern => resolve(api.cwd, pattern)), async () => {
      await updateMockData(() => api.logger.info('Mock file update successful'))
    }, { debounce: 100 })
  })

  api.addBeforeMiddlewares(async () => {
    await updateMockData()
    return [createMockMiddleware({ context })]
  })
}

/** Type helper for mock files: `export default defineMock({ 'GET /api/users': [...] })` */
export function defineMock(mockData: Record<string, IMock['handler'] | ((req: express.Request, res: express.Response, next: express.NextFunction) => any)>) {
  return mockData
}
