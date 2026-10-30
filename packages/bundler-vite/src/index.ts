import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { IBundlerBuildResult, IBundlerDevServer, IBundlerOpts, IEntryAssets, IUniBundlerInstance } from '@cormi/core'
import { build as viteBuild, createServer, type Manifest, mergeConfig } from 'vite'
import { getViteConfig } from './config.ts'

export { getBaseConfig, getViteConfig, toAliases } from './config.ts'
export { CodeFrameError, checkCodePlugin, parseImportClause } from './plugins/checkCode.ts'

function toPosix(path: string) {
  return path.replace(/\\/g, '/')
}

function withBase(base: string, file: string) {
  return `${base.endsWith('/') ? base : base + '/'}${file}`
}

/** Collect the js / css / preload files of an entry from Vite's manifest. */
export function getEntryAssets(manifest: Manifest, key: string, base: string): IEntryAssets {
  const css = new Set<string>()
  const preload = new Set<string>()
  const seen = new Set<string>()
  // static imports are preloaded; css of lazy chunks (routes) is loaded upfront
  // as well, so that server-rendered pages are styled before hydration
  const visit = (id: string, kind: 'entry' | 'static' | 'dynamic') => {
    if (seen.has(id)) return
    seen.add(id)
    const chunk = manifest[id]
    if (!chunk) return
    for (const file of chunk.css ?? []) css.add(withBase(base, file))
    if (kind === 'static') preload.add(withBase(base, chunk.file))
    for (const dep of chunk.imports ?? []) visit(dep, kind === 'dynamic' ? 'dynamic' : 'static')
    for (const dep of chunk.dynamicImports ?? []) visit(dep, 'dynamic')
  }
  visit(key, 'entry')
  const chunk = manifest[key]
  return {
    js: chunk ? [withBase(base, chunk.file)] : [],
    css: [...css],
    preload: [...preload],
  }
}

async function dev(opts: IBundlerOpts): Promise<IBundlerDevServer> {
  const start = Date.now()
  const config = await getViteConfig(opts, { command: 'serve' })
  const server = await createServer(mergeConfig(config, {
    appType: 'custom',
    server: {
      middlewareMode: true,
      hmr: opts.httpServer ? { server: opts.httpServer } : undefined,
    },
  }))
  opts.onDevCompileDone?.({ isFirstCompile: true, stats: null, time: Date.now() - start })
  const base = server.config.base
  return {
    middlewares: server.middlewares as any,
    transformIndexHtml: (url, html) => server.transformIndexHtml(url, html),
    getEntryScripts(entryName) {
      const file = opts.entry[entryName]
      if (!file) return []
      const rel = toPosix(relative(opts.paths.cwd, file))
      return [rel.startsWith('..') ? `${base}@fs${toPosix(file)}` : withBase(base, rel)]
    },
    loadModule: file => server.ssrLoadModule(file) as Promise<any>,
    close: () => server.close(),
  }
}

async function build(opts: IBundlerOpts): Promise<IBundlerBuildResult> {
  const start = Date.now()
  const outputPath = opts.paths.absOutputPath
  let stats: any
  try {
    const config = await getViteConfig(opts, { command: 'build' })
    stats = await viteBuild(config)
    if (opts.serverEntry) {
      const ssrConfig = await getViteConfig(opts, { command: 'build', ssr: true })
      await viteBuild(ssrConfig)
    }
  } catch (err: any) {
    opts.onBuildComplete?.({ isFirstCompile: true, stats, time: Date.now() - start, err })
    throw err
  }

  const manifestPath = join(outputPath, 'manifest.json')
  const manifest: Manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {}
  if (!opts.config.manifest) rmSync(manifestPath, { force: true })
  const base = opts.config.publicPath ?? '/'
  const entries: Record<string, IEntryAssets> = {}
  for (const [name, file] of Object.entries(opts.entry)) {
    entries[name] = getEntryAssets(manifest, toPosix(relative(opts.paths.cwd, file)), base)
  }
  const assets: Record<string, string> = {}
  for (const [key, chunk] of Object.entries(manifest)) {
    const name = chunk.name ? `${chunk.name}${chunk.file.slice(chunk.file.lastIndexOf('.'))}` : key
    assets[name] = withBase(base, chunk.file)
    for (const css of chunk.css ?? []) {
      if (chunk.isEntry && chunk.name) assets[`${chunk.name}.css`] = withBase(base, css)
    }
  }
  const time = Date.now() - start
  const serverBundle = opts.serverEntry ? join(outputPath, 'server', 'server.mjs') : undefined
  opts.onBuildComplete?.({ isFirstCompile: true, stats, time })
  return { outputPath, entries, assets, serverBundle, stats, time }
}

export const bundler: IUniBundlerInstance = { dev, build }

export default bundler
