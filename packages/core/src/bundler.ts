import type { IncomingMessage, Server, ServerResponse } from 'node:http'
import type { Paths } from './paths.ts'
import type { Env } from './types.ts'

/**
 * The bundler abstraction behind `modifyUniBundler` / `modifyUniBundlerOpts`.
 *
 * The preset owns the HTTP server; a bundler only contributes middleware,
 * HTML transforms and server-side module loading, so that Vite and webpack
 * (or any other bundler) are interchangeable.
 */
export interface IUniBundlerInstance {
  dev(opts: IBundlerOpts): Promise<IBundlerDevServer>
  build(opts: IBundlerOpts): Promise<IBundlerBuildResult>
  [key: string]: any
}

export type ConnectMiddleware = (req: IncomingMessage, res: ServerResponse, next: (error?: any) => void) => void

export interface IBabelOptions {
  /** options of cormi's babel preset, after `modifyBabelPresetOpts` */
  presetOpts: IBabelPresetOpts
  beforeBabelPlugins: any[]
  beforeBabelPresets: any[]
  extraBabelPlugins: any[]
  extraBabelPresets: any[]
}

/** Options of cormi's babel preset (the memo of `modifyBabelPresetOpts`). */
export interface IBabelPresetOpts {
  presetEnv?: Record<string, any> | false
  presetReact?: {
    runtime?: 'automatic' | 'classic'
    importSource?: string
    development?: boolean
    [key: string]: any
  }
  presetTypeScript?: Record<string, any>
  pluginTransformRuntime?: Record<string, any> | false
  [key: string]: any
}

export interface ICheckCodeArgs {
  file: string
  code: string
  isFromTmp: boolean
  imports: {
    source: string
    loc: { start: number; end: number }
    default?: string
    namespace?: string
    kind: 'value' | 'type'
    specifiers: Record<string, { name: string; kind: 'value' | 'type' }>
  }[]
  exports: string[]
  cjsExports: string[]
  CodeFrameError: new (message: string, opts?: { loc?: any }) => Error
}

export interface IBundlerOpts {
  cwd: string
  /** where the CLI was started (monorepo root) */
  rootDir: string
  env: Env | `${Env}`
  /** the final config of the app */
  config: Record<string, any>
  pkg: Record<string, any>
  paths: Paths
  /** entry name -> file, after `modifyEntry` */
  entry: Record<string, string>
  /** server bundle entry (SSR / API routes), if the app needs a server */
  serverEntry?: string
  alias: Record<string, string>
  define: Record<string, string>
  babel: IBabelOptions
  react: { runtime: 'automatic' | 'classic' }
  /** `modifyViteConfig`, applied to the final Vite config */
  modifyViteConfig?: (memo: any, args: { env: Env | `${Env}`; ssr?: boolean }) => Promise<any>
  /** `chainWebpack`, applied to the webpack-chain config */
  chainWebpack?: (memo: any, args: { env: Env | `${Env}`; webpack: any; ssr?: boolean }) => Promise<void>
  /** `modifyWebpackConfig`, applied to the final webpack config */
  modifyWebpackConfig?: (memo: any, args: { env: Env | `${Env}`; webpack: any; ssr?: boolean }) => Promise<any>
  /** run `onCheckCode` for a transformed source file */
  checkCode?: (args: Omit<ICheckCodeArgs, 'CodeFrameError'>) => Promise<void>
  // dev
  httpServer?: Server
  port?: number
  host?: string
  ip?: string
  onDevCompileDone?: (opts: { isFirstCompile: boolean; stats: any; time: number; files?: string[] }) => void
  onProgress?: (opts: { percent: number; status?: string }) => void
  // build
  onBuildComplete?: (opts: { isFirstCompile: boolean; stats: any; time: number; err?: Error }) => void
  /** extra options from `modifyUniBundlerOpts` */
  [key: string]: any
}

export interface IBundlerDevServer {
  /** connect middleware serving modules and HMR */
  middlewares: ConnectMiddleware
  /** transform the HTML of a page (inject HMR client, preambles, ...) */
  transformIndexHtml(url: string, html: string): Promise<string>
  /** scripts (urls) loading an entry in the browser */
  getEntryScripts(entryName: string): string[]
  /** load a module on the server, fresh after edits (SSR, API routes) */
  loadModule<T = any>(file: string): Promise<T>
  close(): Promise<void>
}

export interface IEntryAssets {
  /** scripts to load (module scripts) */
  js: string[]
  css: string[]
  /** chunks to `modulepreload` */
  preload: string[]
}

export interface IBundlerBuildResult {
  outputPath: string
  /** assets of each entry, with `publicPath` applied */
  entries: Record<string, IEntryAssets>
  /** source file -> output url, umi's `build-manifest.json` */
  assets: Record<string, string>
  /** the built server bundle (when `serverEntry` was given) */
  serverBundle?: string
  stats?: any
  time: number
}
