import type { IApi } from '../../types.ts'
import { routeExportsPlugin } from '../../utils/routeExports.ts'

/** Picks the bundler (`modifyUniBundler`) and wires the Vite plugins the preset needs. */
export default (api: IApi) => {
  api.describe({
    key: 'preset-react:bundler',
  })

  api.modifyUniBundler(async (memo, { bundler }) => {
    if (memo) return memo
    if (bundler === 'vite') {
      const { bundler } = await import('@cormi/bundler-vite')
      return bundler
    }
    return memo
  })

  api.modifyViteConfig((memo) => {
    const routeFiles = () => {
      const files = new Set<string>()
      for (const route of Object.values<any>(api.appData.routes ?? {})) {
        if (route.__absFile) files.add(route.__absFile)
      }
      return files
    }
    memo.plugins ??= []
    memo.plugins.unshift(routeExportsPlugin({ isRouteFile: file => routeFiles().has(file) }))
    return memo
  })
}
