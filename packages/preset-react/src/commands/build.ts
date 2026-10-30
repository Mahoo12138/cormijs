import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { getMarkup } from '@cormi/server'
import pc from 'picocolors'
import { getHTML } from '../features/html/getHTML.ts'
import { getMarkupArgs } from '../features/html/markupArgs.ts'
import type { IApi, IExportHTMLFile } from '../types.ts'
import { getBundler, getBundlerOpts } from '../utils/bundler.ts'

export default (api: IApi) => {
  api.registerCommand({
    name: 'build',
    description: 'build app for production',
    details: `
cormi build

# build without compression
COMPRESS=none cormi build

`,
    async fn() {
      api.logger.info(pc.cyan(pc.bold(`Cormi v${api.appData.cormi.version}`)))
      rmSync(api.paths.absTmpPath, { recursive: true, force: true })
      await api.applyPlugins({
        key: 'onCheckPkgJSON',
        args: { origin: undefined, current: api.appData.pkg },
      })
      await api.applyPlugins({
        key: 'onGenerateFiles',
        args: { files: null, isFirstTime: true },
      })

      if (process.env.COMPRESS === 'none') {
        api.config.jsMinifier = 'none'
        api.config.cssMinifier = 'none'
      }
      const opts = await getBundlerOpts(api, {
        env: api.env,
        onBuildComplete(opts) {
          api.applyPlugins({ key: 'onBuildComplete', args: opts }).catch(error => api.logger.error(error))
        },
      })
      const bundler = await getBundler(api, opts)
      api.logger.wait('Building...')
      const result = await bundler.build(opts)
      api.appData.buildResult = result

      // HTML
      const entry = result.entries.cormi ?? Object.values(result.entries)[0]
      const content = await getHTML(api, {
        path: '/',
        entryScripts: entry.js.map(src => ({ src, type: 'module' })),
        entryStyles: entry.css,
        preloads: entry.preload,
      })
      const markupArgs = await getMarkupArgs({ api })
      const htmlFiles: IExportHTMLFile[] = await api.applyPlugins({
        key: 'modifyExportHTMLFiles',
        initialValue: [{ path: 'index.html', content }],
        args: { markupArgs, getMarkup },
      })
      for (const file of htmlFiles) {
        const absPath = join(api.paths.absOutputPath, file.path)
        mkdirSync(dirname(absPath), { recursive: true })
        writeFileSync(absPath, file.content, 'utf8')
      }
      await api.applyPlugins({ key: 'onBuildHtmlComplete', args: { htmlFiles } })

      // umi's build-manifest.json, used by SSR to find the client assets
      if (api.config.manifest) {
        writeFileSync(
          join(api.paths.absOutputPath, api.config.manifest.fileName ?? 'build-manifest.json'),
          JSON.stringify({ assets: result.assets, entries: result.entries }, null, 2),
        )
      }

      const outputs = [
        ...entry.js,
        ...entry.css,
        ...htmlFiles.map(file => file.path),
      ]
      api.logger.ready(`Build completed in ${pc.cyan(`${result.time}ms`)} → ${pc.cyan(relative(api.cwd, result.outputPath) || '.')}`)
      for (const file of outputs) api.logger.info(`  ${pc.dim(file)}`)
      if (result.serverBundle) {
        api.logger.info(`  ${pc.dim(relative(result.outputPath, result.serverBundle))} ${pc.gray('(server)')}`)
      }
      return result
    },
  })
}
