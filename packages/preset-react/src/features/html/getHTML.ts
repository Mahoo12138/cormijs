import { getMarkup, type IScript } from '@cormi/server'
import type { IApi } from '../../types.ts'
import { getMarkupArgs } from './markupArgs.ts'

/**
 * The HTML document of the app, with the entry scripts / styles appended.
 * `path` is the requested page, passed to `modifyHTML`.
 */
export async function getHTML(api: IApi, opts: {
  path?: string
  entryScripts: IScript[]
  entryStyles?: string[]
  preloads?: string[]
}) {
  const args = await getMarkupArgs({ api })
  return getMarkup({
    ...args,
    links: [
      ...args.links,
      ...(opts.preloads ?? []).map(href => ({ rel: 'modulepreload', href })),
    ],
    styles: [...args.styles, ...(opts.entryStyles ?? [])],
    scripts: [...args.scripts, ...opts.entryScripts],
    path: opts.path,
  })
}
