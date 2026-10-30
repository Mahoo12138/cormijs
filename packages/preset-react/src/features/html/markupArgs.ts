import { load } from 'cheerio'
import type { IApi, IMarkupArgs } from '../../types.ts'

/** Collect everything that goes into the HTML document (umi's `getMarkupArgs`). */
export async function getMarkupArgs(opts: { api: IApi }): Promise<IMarkupArgs> {
  const { api } = opts
  const headScripts = await api.applyPlugins({ key: 'addHTMLHeadScripts', initialValue: api.config.headScripts || [] })
  const scripts = await api.applyPlugins({ key: 'addHTMLScripts', initialValue: api.config.scripts || [] })
  const metas = await api.applyPlugins({ key: 'addHTMLMetas', initialValue: api.config.metas || [] })
  const links = await api.applyPlugins({ key: 'addHTMLLinks', initialValue: api.config.links || [] })
  const styles = await api.applyPlugins({ key: 'addHTMLStyles', initialValue: api.config.styles || [] })
  const favicons = await api.applyPlugins({ key: 'modifyHTMLFavicon', initialValue: [...(api.config.favicons || [])] })
  return {
    mountElementId: api.config.mountElementId,
    base: api.config.history?.type === 'browser' ? api.config.base : '/',
    routes: api.appData.routes,
    favicons,
    headScripts,
    scripts,
    metas,
    links,
    styles,
    title: api.config.title,
    lang: api.config.lang,
    async modifyHTML(memo: string, args: { path?: string }) {
      if (!api.service.getHooks('modifyHTML').length) return memo
      let $ = load(memo)
      $ = await api.applyPlugins({ key: 'modifyHTML', initialValue: $, args })
      return $.html()
    },
  }
}
