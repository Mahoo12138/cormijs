import type { PluginAPI } from '@cormi/core'
import build from './commands/build.ts'
import config from './commands/config.ts'
import dev from './commands/dev/dev.ts'
import generators from './commands/generators/generators.ts'
import help from './commands/help.ts'
import plugin from './commands/plugin.ts'
import preview from './commands/preview.ts'
import setup from './commands/setup.ts'
import version from './commands/version.ts'
import apiRoute from './features/apiRoute/apiRoute.ts'
import appData from './features/appData/appData.ts'
import bundler from './features/bundler/bundler.ts'
import check from './features/check/check.ts'
import configPlugins from './features/configPlugins/configPlugins.ts'
import exportStatic from './features/exportStatic/exportStatic.ts'
import favicons from './features/favicons/favicons.ts'
import mock from './features/mock/mock.ts'
import proxy from './features/proxy/proxy.ts'
import routePrefetch from './features/routePrefetch/routePrefetch.ts'
import ssr from './features/ssr/ssr.ts'
import tmpFiles from './features/tmpFiles/tmpFiles.ts'
import registerMethods from './registerMethods.ts'
import type { IApi } from './types.ts'

export * from './types.ts'
export { BUILTIN_RUNTIME_KEYS, RUNTIME_TYPE_FILE_NAME } from './constants.ts'
export { createMockMiddleware, defineMock, getMockData, type IMock } from './features/mock/mock.ts'
export { createProxyMiddlewares } from './features/proxy/proxy.ts'
export { getRoutes, getApiRoutes } from './features/tmpFiles/routes.ts'
export { getMarkupArgs } from './features/html/markupArgs.ts'
export { transformExports } from './utils/routeExports.ts'
export { getModuleExports } from './utils/getModuleExports.ts'

type Feature = (api: IApi) => void

/** Give a builtin plugin the id / key umi derives from its file path. */
function feature(path: string, fn: Feature) {
  const key = path.split('/').pop()!
  return Object.assign((api: PluginAPI) => fn(api as IApi), { id: `@@/${path}`, key })
}

/**
 * The builtin preset (umi's `preset-umi`). Features are plugins written with
 * the same API as third-party plugins; order matters for hooks without `stage`.
 */
export default function presetReact() {
  return {
    plugins: [
      feature('registerMethods', registerMethods),

      // features
      feature('features/appData/appData', appData),
      feature('features/check/check', check),
      feature('features/configPlugins/configPlugins', configPlugins),
      feature('features/favicons/favicons', favicons),
      feature('features/mock/mock', mock),
      feature('features/proxy/proxy', proxy),
      feature('features/routePrefetch/routePrefetch', routePrefetch),
      // generates the tmp files others depend on
      feature('features/tmpFiles/tmpFiles', tmpFiles),
      feature('features/ssr/ssr', ssr),
      feature('features/exportStatic/exportStatic', exportStatic),
      feature('features/apiRoute/apiRoute', apiRoute),
      feature('features/bundler/bundler', bundler),

      // commands
      feature('commands/build', build),
      feature('commands/config', config),
      feature('commands/dev/dev', dev),
      feature('commands/help', help),
      feature('commands/plugin', plugin),
      feature('commands/preview', preview),
      feature('commands/setup', setup),
      feature('commands/version', version),
      feature('commands/generators/generators', generators),
    ],
  }
}

presetReact.id = '@cormi/preset-react'
presetReact.key = 'presetReact'
