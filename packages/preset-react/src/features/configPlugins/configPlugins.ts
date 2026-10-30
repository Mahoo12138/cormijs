import type { SchemaHelpers } from '@cormi/core'
import type { IApi } from '../../types.ts'

type SchemaFactory = (helpers: SchemaHelpers) => any

export function getSchemas(): Record<string, SchemaFactory> {
  const assetsSchema: SchemaFactory = ({ zod }) => zod.array(zod.union([
    zod.string(),
    zod.record(zod.string(), zod.any()),
  ]))
  const tagsSchema: SchemaFactory = ({ zod }) => zod.array(zod.record(zod.string(), zod.any()))
  return {
    alias: ({ zod }) => zod.record(zod.string(), zod.string()),
    base: ({ zod }) => zod.string(),
    bundler: ({ zod }) => zod.string(),
    extraBabelPlugins: ({ zod }) => zod.array(zod.any()),
    extraBabelPresets: ({ zod }) => zod.array(zod.any()),
    clientLoader: ({ zod }) => zod.union([zod.object({}).passthrough(), zod.literal(false)]),
    conventionLayout: ({ zod }) => zod.boolean(),
    conventionRoutes: ({ zod }) => zod.object({
      base: zod.string().optional(),
      exclude: zod.array(zod.instanceof(RegExp)).optional(),
    }),
    cssMinifier: ({ zod }) => zod.enum(['esbuild', 'none']),
    cssModules: ({ zod }) => zod.record(zod.string(), zod.any()),
    define: ({ zod }) => zod.record(zod.string(), zod.any()),
    devtool: ({ zod }) => zod.union([zod.string(), zod.boolean()]),
    externals: ({ zod }) => zod.record(zod.string(), zod.string()),
    hash: ({ zod }) => zod.boolean(),
    headScripts: assetsSchema,
    history: ({ zod }) => zod.object({ type: zod.enum(['browser', 'hash', 'memory']) }),
    jsMinifier: ({ zod }) => zod.enum(['esbuild', 'none']),
    lang: ({ zod }) => zod.string(),
    links: tagsSchema,
    manifest: ({ zod }) => zod.object({}).passthrough(),
    metas: tagsSchema,
    mountElementId: ({ zod }) => zod.string(),
    npmClient: ({ zod }) => zod.enum(['pnpm', 'tnpm', 'cnpm', 'yarn', 'npm', 'bun']),
    outputPath: ({ zod }) => zod.string(),
    plugins: ({ zod }) => zod.array(zod.any()),
    presets: ({ zod }) => zod.array(zod.any()),
    publicPath: ({ zod }) => zod.string().regex(/(\/|^auto)$/, 'publicPath must be "auto" or end with /'),
    reactRouter5Compat: ({ zod }) => zod.union([zod.boolean(), zod.object({}).passthrough()]),
    routes: ({ zod }) => zod.array(zod.record(zod.string(), zod.any())),
    runtimePublicPath: ({ zod }) => zod.object({}).passthrough(),
    scripts: assetsSchema,
    styles: assetsSchema,
    targets: ({ zod }) => zod.union([zod.string(), zod.array(zod.string())]),
    title: ({ zod }) => zod.string(),
    vite: ({ zod }) => zod.record(zod.string(), zod.any()),
  }
}

/** Keys whose change only needs the tmp files (and the HTML) to be regenerated. */
const REGENERATE_KEYS = ['routes', 'conventionRoutes', 'conventionLayout', 'title', 'lang', 'metas', 'links', 'styles', 'scripts', 'headScripts', 'clientLoader']

export default (api: IApi) => {
  const configDefaults: Record<string, any> = {
    alias: {
      cormi: '@@/exports',
    },
    publicPath: '/',
    mountElementId: 'root',
    base: '/',
    history: { type: 'browser' },
  }

  const schemas = getSchemas()
  api.registerPlugins(Object.keys(schemas).map((key) => {
    const config: Record<string, any> = { schema: schemas[key] }
    if (key in configDefaults) config.default = configDefaults[key]
    if (REGENERATE_KEYS.includes(key)) config.onChange = api.ConfigChangeType.regenerateTmpFiles
    return { id: `virtual: config-${key}`, key, config }
  }))

  // `api.paths` is ready after the register stage
  api.modifyConfig((memo, args) => {
    memo.alias = {
      ...memo.alias,
      '@': args.paths.absSrcPath,
      '@@': args.paths.absTmpPath,
    }
    return memo
  })
}
