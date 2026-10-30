import type {
  Env,
  IAdd,
  IBabelPresetOpts,
  IBundlerOpts,
  ICheckCodeArgs,
  IEvent,
  IModify,
  IRoute,
  IUniBundlerInstance,
  PluginAPI,
} from '@cormi/core'
import type { ILink, IMeta, IScript, IStyle } from '@cormi/server'
import type { CheerioAPI } from 'cheerio'
import type { Express, RequestHandler } from 'express'
import type { InlineConfig as ViteInlineConfig } from 'vite'

export type { ILink, IMeta, IRoute, IScript, IStyle }

export interface IEntryImport {
  source: string
  specifier?: string
}

export interface IApiMiddleware {
  name: string
  path: string
}

export type IFileInfo = Array<{ event: string; path: string }>

export interface ITmpGenerateWatcher {
  path: string
  /** chokidar events to react to (default: all) */
  events?: string[]
}

export interface IOnGenerateFiles {
  files?: IFileInfo | null
  isFirstTime?: boolean
}

export interface IOnDemandInstallDep {
  name: string
  version: string
  dev?: boolean
  reason?: string
}

export interface IUIModule {
  name: string
  menus?: { path: string; url: string; icon: string; name: string }[]
  [key: string]: any
}

export interface IExportHTMLFile {
  path: string
  content: string
}

export type GenerateFilesFn = (opts: IOnGenerateFiles) => Promise<void>

export interface IWriteTmpFileOptions {
  path: string
  /** text content; when given, no template is rendered */
  content?: string
  /** Mustache template string */
  tpl?: string
  /** path of a Mustache template file */
  tplPath?: string
  /** template context */
  context?: Record<string, any>
  /** write to the tmp dir itself instead of `plugin-<key>/` */
  noPluginDir?: boolean
}

export interface IMarkupArgs {
  mountElementId: string
  base: string
  routes: Record<string, IRoute>
  favicons: string[]
  headScripts: IScript[]
  scripts: IScript[]
  metas: IMeta[]
  links: ILink[]
  styles: IStyle[]
  title?: string
  lang?: string
  modifyHTML: (memo: string, args: { path?: string }) => Promise<string>
}

/** The typed plugin API of a cormi app. */
export type IApi = PluginAPI & {
  addApiMiddlewares: IAdd<null, IApiMiddleware>
  addBeforeBabelPlugins: IAdd<null, any>
  addBeforeBabelPresets: IAdd<null, any>
  addBeforeMiddlewares: IAdd<null, RequestHandler>
  addEntryCode: IAdd<null, string>
  addEntryCodeAhead: IAdd<null, string>
  addEntryImports: IAdd<null, IEntryImport>
  addEntryImportsAhead: IAdd<null, IEntryImport>
  addExtraBabelPlugins: IAdd<null, any>
  addExtraBabelPresets: IAdd<null, any>
  addHTMLHeadScripts: IAdd<null, IScript>
  addHTMLLinks: IAdd<null, ILink>
  addHTMLMetas: IAdd<null, IMeta>
  addHTMLScripts: IAdd<null, IScript>
  addHTMLStyles: IAdd<null, IStyle>
  addLayouts: IAdd<null, { file: string; id: string; test?: (route: IRoute) => boolean }>
  addMiddlewares: IAdd<null, RequestHandler>
  addOnDemandDeps: IAdd<null, IOnDemandInstallDep>
  addPolyfillImports: IAdd<null, IEntryImport>
  addPrepareBuildPlugins: IAdd<null, import('esbuild').Plugin>
  addRuntimePlugin: IAdd<null, string>
  addRuntimePluginKey: IAdd<null, string>
  addTmpGenerateWatcherPaths: IAdd<null, string | ITmpGenerateWatcher>
  addUIModules: IAdd<null, IUIModule>
  chainWebpack: IModify<any, { env: Env; ssr?: boolean; webpack: any }>
  modifyBabelPresetOpts: IModify<IBabelPresetOpts, null>
  modifyEntry: IModify<Record<string, string>, null>
  modifyExportHTMLFiles: IModify<IExportHTMLFile[], { getMarkup: typeof import('@cormi/server').getMarkup; markupArgs: IMarkupArgs }>
  modifyHTML: IModify<CheerioAPI, { path?: string }>
  modifyHTMLFavicon: IModify<string[], {}>
  modifyRendererPath: IModify<string, {}>
  modifyRoutes: IModify<Record<string, IRoute>, {}>
  modifyServerRendererPath: IModify<string, {}>
  modifyTSConfig: IModify<Record<string, any>, {}>
  modifyUniBundler: IModify<IUniBundlerInstance, { bundler: string; opts: IBundlerOpts }>
  modifyUniBundlerOpts: IModify<IBundlerOpts, { bundler: string }>
  modifyViteConfig: IModify<ViteInlineConfig, { env: Env; ssr?: boolean }>
  modifyWebpackConfig: IModify<any, { env: Env; ssr?: boolean; webpack: any }>
  onBeforeCompiler: IEvent<{ compiler: string; opts: IBundlerOpts }>
  onBeforeMiddleware: IEvent<{ app: Express }>
  onBuildComplete: IEvent<{ isFirstCompile: boolean; stats: any; time: number; err?: Error }>
  onBuildHtmlComplete: IEvent<{ htmlFiles?: IExportHTMLFile[] }>
  onCheckCode: IEvent<ICheckCodeArgs>
  onCheckConfig: IEvent<{ config: Record<string, any>; userConfig: Record<string, any> }>
  onCheckPkgJSON: IEvent<{ current: Record<string, any>; origin?: Record<string, any> }>
  onDevCompileDone: IEvent<{ isFirstCompile: boolean; stats: any; time: number }>
  onGenerateFiles: IEvent<IOnGenerateFiles>
  onPatchRoute: IEvent<{ route: IRoute }>
  onPkgJSONChanged: IEvent<{ current: Record<string, any>; origin: Record<string, any> }>
  onPrepareBuildSuccess: IEvent<{ isWatch: boolean; result: import('esbuild').BuildResult }>
  /** restart the app in-process; `hard` starts a new process when run by the CLI daemon */
  restartServer: (opts?: { hard?: boolean }) => void
  writeTmpFile: (opts: IWriteTmpFileOptions) => void
}

/** Config of a cormi app (`.cormirc.ts` / `config/config.ts`). */
export interface IConfig {
  alias?: Record<string, string>
  base?: string
  clientLoader?: {}
  conventionLayout?: boolean
  conventionRoutes?: { base?: string; exclude?: RegExp[] }
  define?: Record<string, any>
  devtool?: boolean | string
  exportStatic?: { extraRoutePaths?: string[] | (() => string[] | Promise<string[]>); ignorePreRenderError?: boolean }
  favicons?: string[]
  hash?: boolean
  headScripts?: IScript[]
  history?: { type: 'browser' | 'hash' | 'memory' }
  links?: ILink[]
  manifest?: {}
  metas?: IMeta[]
  mock?: false | { exclude?: string[]; include?: string[] }
  mountElementId?: string
  npmClient?: 'pnpm' | 'tnpm' | 'cnpm' | 'yarn' | 'npm' | 'bun'
  outputPath?: string
  plugins?: string[]
  presets?: string[]
  proxy?: Record<string, any>
  publicPath?: string
  reactRouter5Compat?: boolean
  routePrefetch?: { defaultPrefetch?: 'none' | 'intent' | 'render' | 'viewport'; defaultPrefetchTimeout?: number }
  routes?: any[]
  scripts?: IScript[]
  ssr?: { useStream?: boolean }
  styles?: IStyle[]
  targets?: string | string[]
  terminal?: false | {}
  title?: string
  vite?: ViteInlineConfig
  [key: string]: any
}
