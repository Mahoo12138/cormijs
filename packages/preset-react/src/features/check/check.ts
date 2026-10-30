import type { IApi } from '../../types.ts'

const MIN_NODE_VERSION = 22

/** Sanity checks before starting: node version, react, conflicting config. */
export default (api: IApi) => {
  api.describe({
    key: 'preset-react:check',
  })

  api.onCheck(() => {
    const major = parseInt(process.versions.node.split('.')[0], 10)
    if (major < MIN_NODE_VERSION) {
      throw new Error(`Cormi requires node >= ${MIN_NODE_VERSION}, current is ${process.versions.node}.`)
    }
    if (!api.appData.react) {
      throw new Error('react is not installed, run `npm install react react-dom`.')
    }
    if (api.config.routes && api.config.conventionRoutes) {
      api.logger.warn('`conventionRoutes` is ignored since `routes` is configured.')
    }
  })

  api.onCheckPkgJSON(({ current }) => {
    const deps = { ...current?.dependencies, ...current?.devDependencies }
    if (deps['react-router-dom']) {
      api.logger.warn('`react-router-dom` is not needed: cormi bundles react-router, import from `cormi` instead.')
    }
  })

  // generated files and server-only modules must not be imported from the browser
  api.onCheckCode(({ file, imports, isFromTmp, CodeFrameError }) => {
    if (isFromTmp || file.includes(`${api.paths.absApiRoutesPath}/`)) return
    for (const item of imports) {
      if (item.source === '@cormi/server' || item.source.startsWith('node:')) {
        if (item.kind === 'type') continue
        if (Object.values(item.specifiers).every(spec => spec.kind === 'type')) continue
        // route modules may use them in `serverLoader`, which is stripped from the client
        if (Object.values(api.appData.routes ?? {}).some((route: any) => route.__absFile === file && route.hasServerLoader)) continue
        throw new CodeFrameError(`"${item.source}" is a server-only module and can't be imported in browser code`, { loc: item.loc })
      }
    }
  })
}
