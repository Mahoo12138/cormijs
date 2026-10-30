import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { IApi } from '../../types.ts'

const FAVICON_FILES = ['favicon.ico', 'favicon.png', 'favicon.svg', 'favicon.gif', 'favicon.jpg', 'favicon.jpeg', 'favicon.webp']

/** `config.favicons`, or `public/favicon.*` when it exists. */
export default (api: IApi) => {
  api.describe({
    key: 'favicons',
    config: {
      schema: ({ zod }) => zod.array(zod.string()),
    },
  })

  api.modifyAppData((memo) => {
    const publicDir = join(api.cwd, 'public')
    memo.faviconFiles = FAVICON_FILES.filter(file => existsSync(join(publicDir, file)))
    return memo
  })

  api.modifyHTMLFavicon((memo) => {
    if (memo.length || !api.appData.faviconFiles?.length) return memo
    const publicPath = api.config.publicPath === 'auto' ? '/' : api.config.publicPath
    return api.appData.faviconFiles.map((file: string) => `${publicPath}${file}`)
  })
}
