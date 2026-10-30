import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { IBundlerOpts } from '@cormi/core'
import react from '@vitejs/plugin-react'
import { type Alias, type InlineConfig, mergeConfig, type Plugin } from 'vite'
import { checkCodePlugin } from './plugins/checkCode.ts'

export interface GetConfigOptions {
  command: 'serve' | 'build'
  ssr?: boolean
}

// resolved from the app root, so only packages the app depends on itself
const DEDUPE = ['react', 'react-dom']

/**
 * `{ foo: 'bar' }` -> aliases matching `foo` and `foo/*` (not `foobar`);
 * a trailing `$` (webpack style) matches the exact specifier only.
 */
export function toAliases(alias: Record<string, string>): Alias[] {
  return Object.entries(alias)
    // longest first, so that `@@` wins over `@`
    .sort(([a], [b]) => b.length - a.length)
    .map(([find, replacement]) => find.endsWith('$')
      ? { find: new RegExp(`^${escapeRegExp(find.slice(0, -1))}$`), replacement }
      : { find: new RegExp(`^${escapeRegExp(find)}(?=/|$)`), replacement })
}

function escapeRegExp(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The Vite config of an app, before `config.vite` and `modifyViteConfig`. */
export function getBaseConfig(opts: IBundlerOpts, options: GetConfigOptions): InlineConfig {
  const { config, paths, babel } = opts
  const isDev = options.command === 'serve'
  const plugins: Plugin[] = []

  const presetReact = babel.presetOpts.presetReact ?? {}
  plugins.push(...react({
    jsxRuntime: presetReact.runtime ?? opts.react.runtime,
    jsxImportSource: presetReact.importSource,
    babel: {
      plugins: [...babel.beforeBabelPlugins, ...babel.extraBabelPlugins],
      presets: [...babel.beforeBabelPresets, ...babel.extraBabelPresets],
    },
  }) as Plugin[])

  if (opts.checkCode) {
    plugins.push(checkCodePlugin({ cwd: paths.cwd, absTmpPath: paths.absTmpPath, checkCode: opts.checkCode }))
  }

  if (isDev && opts.onDevCompileDone) {
    const onDevCompileDone = opts.onDevCompileDone
    plugins.push({
      name: 'cormi:dev-compile-done',
      handleHotUpdate(ctx) {
        const start = Date.now()
        queueMicrotask(() => onDevCompileDone({
          isFirstCompile: false,
          stats: { modules: ctx.modules.map(mod => mod.id) },
          time: Date.now() - start,
          files: [ctx.file],
        }))
      },
    })
  }

  const publicDir = join(paths.cwd, 'public')
  const sourcemap = config.devtool === false ? false : isDev ? true : config.devtool ? true : false

  return {
    configFile: false,
    envFile: false,
    root: paths.cwd,
    base: config.publicPath ?? '/',
    mode: opts.env,
    clearScreen: false,
    logLevel: process.env.DEBUG ? 'info' : 'warn',
    publicDir: existsSync(publicDir) ? publicDir : false,
    cacheDir: join(paths.absNodeModulesPath, '.cache', 'vite'),
    plugins,
    define: opts.define,
    resolve: {
      alias: toAliases(opts.alias),
      dedupe: DEDUPE,
    },
    css: {
      devSourcemap: true,
      modules: config.cssModules ?? undefined,
    },
    json: { stringify: 'auto' },
    optimizeDeps: {
      entries: Object.values(opts.entry),
      include: ['react', 'react-dom', 'react-dom/client', 'react/jsx-runtime', 'react/jsx-dev-runtime'],
    },
    ssr: {
      noExternal: ['@cormi/renderer-react', '@cormi/server'],
    },
    build: {
      outDir: paths.absOutputPath,
      assetsDir: 'static',
      sourcemap,
      manifest: options.ssr ? false : 'manifest.json',
      ssrManifest: false,
      emptyOutDir: !options.ssr,
      target: config.targets ?? 'es2020',
      minify: config.jsMinifier === 'none' ? false : 'esbuild',
      cssMinify: config.cssMinifier === 'none' ? false : 'esbuild',
      rollupOptions: options.ssr
        ? {
            input: { server: opts.serverEntry! },
            output: {
              entryFileNames: '[name].mjs',
              chunkFileNames: 'chunks/[name]-[hash].mjs',
              format: 'es',
            },
          }
        : {
            input: opts.entry,
            output: config.hash === false
              ? {
                  entryFileNames: 'static/[name].js',
                  chunkFileNames: 'static/[name].js',
                  assetFileNames: 'static/[name][extname]',
                }
              : undefined,
          },
      ...(options.ssr ? { ssr: true, outDir: join(paths.absOutputPath, 'server') } : {}),
    },
    server: {
      host: opts.host,
      fs: {
        strict: false,
      },
    },
  }
}

/** Apply `config.vite` (user overrides) then `modifyViteConfig`. */
export async function getViteConfig(opts: IBundlerOpts, options: GetConfigOptions) {
  let config = getBaseConfig(opts, options)
  if (opts.config.vite && typeof opts.config.vite === 'object') {
    config = mergeConfig(config, opts.config.vite)
  }
  if (opts.modifyViteConfig) {
    config = await opts.modifyViteConfig(config, { env: opts.env, ssr: options.ssr }) ?? config
  }
  return config
}
