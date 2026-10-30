import { existsSync } from 'node:fs'
import { createProductionServer } from '@cormi/server'
import pc from 'picocolors'
import { createMockMiddleware, getMockData } from '../features/mock/mock.ts'
import { createProxyMiddlewares } from '../features/proxy/proxy.ts'
import type { IApi } from '../types.ts'
import { getLocalIP, getPort } from '../utils/watch.ts'

export default (api: IApi) => {
  api.registerCommand({
    name: 'preview',
    description: 'locally preview production build',
    details: `
cormi preview

# specify hostname
cormi preview --host [host]

# specify port
cormi preview --port [port]

# serve the mock data as in dev
cormi preview --mock
`,
    async fn({ args }) {
      const outputPath = api.paths.absOutputPath
      if (!existsSync(outputPath)) throw new Error('build output dir not found, please run `cormi build`')
      const beforeMiddlewares: any[] = []
      if (api.config.proxy) beforeMiddlewares.push(...createProxyMiddlewares(api.config.proxy))
      if (args.mock && api.config.mock !== false) {
        const context = { mockData: await getMockData({ cwd: api.cwd, mockConfig: api.config.mock || {} }) }
        beforeMiddlewares.push(createMockMiddleware({ context }))
      }
      const server = await createProductionServer({
        outputPath,
        publicPath: api.config.publicPath === 'auto' ? '/' : api.config.publicPath,
        base: api.config.base,
        beforeMiddlewares,
        onError: error => api.logger.error(error),
      })

      const host = args.host ?? process.env.HOST ?? '0.0.0.0'
      const port = await getPort(parseInt(String(args.port ?? process.env.PORT ?? 4172), 10))
      const httpServer = await server.listen(port, host)
      api.ctx.effect(() => () => new Promise<void>(resolve => httpServer.close(() => resolve())), 'preview.listen()')
      const ip = getLocalIP()
      api.logger.ready(`Preview server listening at:\n  > Local:   ${pc.cyan(`http://localhost:${port}`)}${ip ? `\n  > Network: ${pc.cyan(`http://${ip}:${port}`)}` : ''}`)
      return { port }
    },
  })
}
