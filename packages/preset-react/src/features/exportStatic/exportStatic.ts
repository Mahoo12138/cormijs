import { dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { IRoute } from '@cormi/core'
import type { IApi, IExportHTMLFile, IMarkupArgs } from '../../types.ts'

const IS_WIN = process.platform === 'win32'

export interface IExportHtmlItem {
  route: { path: string; redirect?: string }
  file: string
  prerender: boolean
}

type IUserExtraRoute = string | { path: string; prerender?: boolean }

/** One HTML file per static route: `/users` -> `users/index.html`, `/*` -> `404.html`. */
export function getExportHtmlData(routes: Record<string, IRoute>): IExportHtmlItem[] {
  const map = new Map<string, IExportHtmlItem>()
  for (const route of Object.values(routes)) {
    const absPath: string = route.absPath ?? route.path
    const is404 = absPath === '/*' || route.id === '404'
    // layouts, dynamic routes on windows (`:` is not allowed in file names) and `*` routes
    if (route.isLayout) continue
    if (IS_WIN && absPath.includes('/:')) continue
    if (absPath.includes('*') && !is404) continue
    if (absPath.includes('/:') && !is404) continue
    const file = is404 ? '404.html' : join('.', absPath, 'index.html')
    map.set(file, {
      route: { path: is404 ? '/404' : absPath, redirect: route.redirect },
      prerender: route.prerender !== false,
      file,
    })
  }
  return [...map.values()]
}

function prefixAssets(markupArgs: IMarkupArgs, publicPath: string, prefix: string): IMarkupArgs {
  const rewrite = (url: string) => url.startsWith(publicPath) ? `${prefix}/${url.slice(publicPath.length)}` : url
  const rewriteItem = (item: any) => {
    if (typeof item === 'string') return rewrite(item)
    const copy = { ...item }
    if (copy.src) copy.src = rewrite(copy.src)
    if (copy.href) copy.href = rewrite(copy.href)
    return copy
  }
  return {
    ...markupArgs,
    favicons: markupArgs.favicons.map(rewrite),
    links: markupArgs.links.map(rewriteItem),
    styles: markupArgs.styles.map(rewriteItem),
    headScripts: markupArgs.headScripts.map(rewriteItem),
    scripts: markupArgs.scripts.map(rewriteItem),
  }
}

export default (api: IApi) => {
  api.describe({
    config: {
      schema: ({ zod }) => zod.object({
        extraRoutePaths: zod.union([zod.function(), zod.array(zod.union([zod.string(), zod.object({ path: zod.string(), prerender: zod.boolean().optional() })]))]),
        ignorePreRenderError: zod.boolean(),
      }).partial(),
    },
    enableBy: api.EnableBy.config,
  })

  async function getExtraRoutes(): Promise<Record<string, IRoute>> {
    const option = api.config.exportStatic?.extraRoutePaths ?? []
    const paths: IUserExtraRoute[] = typeof option === 'function' ? await option() : option
    return Object.fromEntries(paths.map((item) => {
      const path = typeof item === 'string' ? item : item.path
      const route: IRoute = { id: path, absPath: path, path: path.slice(1), file: '' }
      if (typeof item === 'object' && item.prerender === false) route.prerender = false
      return [path, route]
    }))
  }

  api.onGenerateFiles(async () => {
    const htmlData = [
      ...getExportHtmlData(api.appData.routes),
      ...getExportHtmlData(await getExtraRoutes()),
    ]
    api.appData.exportHtmlData = htmlData
    // pages excluded from prerendering are rendered on the client
    api.writeTmpFile({
      path: 'runtime.ts',
      content: `
const ignorePaths: string[] = ${JSON.stringify(htmlData.filter(item => !item.prerender).map(item => item.route.path))};
export function modifyClientRenderOpts(memo: any) {
  return { ...memo, hydrate: memo.hydrate && !ignorePaths.includes(memo.history.location.pathname) };
}
`,
    })
  })

  api.addRuntimePlugin(() => [join(api.paths.absTmpPath, 'plugin-exportStatic/runtime.ts')])

  api.modifyExportHTMLFiles(async (defaultFiles, { markupArgs, getMarkup }) => {
    const publicPath: string = api.config.publicPath
    const htmlData: IExportHtmlItem[] = api.appData.exportHtmlData
    const entryScripts = api.appData.buildResult?.entries?.cormi
    const serverBundle: string | undefined = api.appData.buildResult?.serverBundle
    const templates = new Map<string, string>()
    let handler: ((request: Request) => Promise<Response | undefined>) | undefined
    if (api.config.ssr && serverBundle) {
      const bundle = await import(pathToFileURL(serverBundle).href)
      handler = bundle.createRequestHandler({
        getTemplate: async (url: URL) => templates.get(url.pathname) ?? defaultFiles[0].content,
        onError: (error: unknown) => api.logger.error(error),
      })
    }
    const files: IExportHTMLFile[] = []
    for (const { file, route, prerender } of htmlData) {
      let args: IMarkupArgs = {
        ...markupArgs,
        scripts: [...markupArgs.scripts, ...(entryScripts?.js ?? []).map((src: string) => ({ src, type: 'module' }))],
        styles: [...markupArgs.styles, ...(entryScripts?.css ?? [])],
        links: [...markupArgs.links, ...(entryScripts?.preload ?? []).map((href: string) => ({ rel: 'modulepreload', href }))],
      }
      // relative publicPath (`./`): assets are relative to each html file
      if (publicPath.startsWith('.')) {
        const prefix = relative(dirname(file), '.') || '.'
        args = prefixAssets(args, publicPath, prefix)
      }
      let content = await getMarkup({ ...args, path: route.path })
      if (handler && prerender) {
        const base = (api.config.base as string).replace(/\/$/, '')
        const location = `${base}${route.path}`
        templates.set(location, content)
        try {
          const response = await handler(new Request(`http://localhost${location}`, { headers: { accept: 'text/html' } }))
          if (response?.ok) {
            content = await response.text()
            api.logger.info(`Pre-render for ${route.path}`)
          }
        } catch (error) {
          api.logger.error(`Pre-render ${route.path} error: ${error}`)
          if (!api.config.exportStatic.ignorePreRenderError) throw error
        }
      }
      files.push({ path: file, content })
    }
    // keep `index.html` (e.g. `/` is not a route)
    if (!files.some(file => file.path === 'index.html')) files.push(...defaultFiles.filter(file => file.path === 'index.html'))
    return files
  })
}
