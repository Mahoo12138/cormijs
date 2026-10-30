import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const DEFAULT_PORT = 8000
export const DEFAULT_HOST = '0.0.0.0'

const here = dirname(fileURLToPath(import.meta.url))

/** `templates/` sits next to `src/` and `lib/` */
export const TEMPLATES_DIR = join(here, '../templates')

/** written by plugins into `plugin-<key>/`, merged into `RuntimeConfig` */
export const RUNTIME_TYPE_FILE_NAME = 'runtimeConfig.d.ts'

export const BUILTIN_RUNTIME_KEYS = [
  'patchRoutes',
  'patchClientRoutes',
  'modifyContextOpts',
  'modifyClientRenderOpts',
  'rootContainer',
  'innerProvider',
  'i18nProvider',
  'accessProvider',
  'dataflowProvider',
  'outerProvider',
  'render',
  'onRouteChange',
  'modifyServerLoaderRequest',
]
