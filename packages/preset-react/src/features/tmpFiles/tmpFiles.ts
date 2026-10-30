import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { lodash, readJSON, resolvePackageDir, winPath } from '@cormi/core'
import { BUILTIN_RUNTIME_KEYS, RUNTIME_TYPE_FILE_NAME, TEMPLATES_DIR } from '../../constants.ts'
import type { IApi } from '../../types.ts'
import { getModuleExports } from '../../utils/getModuleExports.ts'
import { importsToStr } from '../../utils/importsToStr.ts'
import { componentToChunkName } from './routes.ts'

const here = dirname(fileURLToPath(import.meta.url))

/** Directory of a package that the preset depends on. */
export function resolvePresetDep(name: string) {
  const dir = resolvePackageDir(name, here)
  if (!dir) throw new Error(`Cannot find ${name} from @cormi/preset-react.`)
  return winPath(dir)
}

/** The js entry of a package directory (its `exports['.']` / `main`). */
export function getPackageEntry(dir: string) {
  const pkg = readJSON(join(dir, 'package.json')) ?? {}
  const exp = pkg.exports?.['.']
  const entry = typeof exp === 'string' ? exp : exp?.default ?? exp?.import ?? pkg.module ?? pkg.main ?? 'index.js'
  return winPath(join(dir, entry))
}

const TYPINGS = `
type CSSModuleClasses = { readonly [key: string]: string }
declare module '*.module.css' { const classes: CSSModuleClasses; export default classes }
declare module '*.module.less' { const classes: CSSModuleClasses; export default classes }
declare module '*.module.scss' { const classes: CSSModuleClasses; export default classes }
declare module '*.module.sass' { const classes: CSSModuleClasses; export default classes }
declare module '*.css' { const classes: CSSModuleClasses; export default classes }
declare module '*.less' { const classes: CSSModuleClasses; export default classes }
declare module '*.scss' { const classes: CSSModuleClasses; export default classes }
declare module '*.sass' { const classes: CSSModuleClasses; export default classes }
declare module '*.styl' { const classes: CSSModuleClasses; export default classes }
${['jpg', 'jpeg', 'png', 'gif', 'svg', 'ico', 'webp', 'avif', 'bmp', 'mp4', 'webm', 'ogg', 'mp3', 'wav', 'flac', 'aac', 'woff', 'woff2', 'eot', 'ttf', 'otf', 'webmanifest', 'pdf', 'txt']
  .map(ext => `declare module '*.${ext}' { const src: string; export default src }`).join('\n')}
declare module '*?raw' { const content: string; export default content }
declare module '*?url' { const src: string; export default src }
`

export default (api: IApi) => {
  api.describe({
    key: 'tmpFiles',
    config: {
      schema: ({ zod }) => zod.boolean(),
    },
  })

  api.onGenerateFiles(async (opts) => {
    const rendererPath = winPath(await api.applyPlugins({
      key: 'modifyRendererPath',
      initialValue: resolvePresetDep('@cormi/renderer-react'),
    }))
    const serverPath = winPath(await api.applyPlugins({
      key: 'modifyServerRendererPath',
      initialValue: resolvePresetDep('@cormi/server'),
    }))
    api.appData.rendererPath = rendererPath
    api.appData.serverRendererPath = serverPath

    // tsconfig.json, always in the dev tmp dir (`src/.cormi`): the project's
    // tsconfig extends it, whatever env generated the tmp files
    const tsconfigDir = join(api.paths.absSrcPath, `.${api.service.frameworkName}`)
    const tsconfigPath = join(tsconfigDir, 'tsconfig.json')
    const toTmpRelative = (path: string) => {
      const rel = winPath(relative(tsconfigDir, path))
      if (!rel) return '.'
      return rel.startsWith('.') ? rel : `./${rel}`
    }
    const tmpDir = toTmpRelative(api.paths.absTmpPath)
    const cormiPkgDir = resolvePackageDir('cormi', api.cwd)
    let tsconfig: Record<string, any> = {
      compilerOptions: {
        target: 'esnext',
        module: 'esnext',
        lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: true,
        skipLibCheck: true,
        moduleResolution: 'bundler',
        noEmit: true,
        jsx: 'react-jsx',
        esModuleInterop: true,
        sourceMap: true,
        strict: true,
        resolveJsonModule: true,
        allowSyntheticDefaultImports: true,
        isolatedModules: true,
        paths: {
          '@/*': [`${toTmpRelative(api.paths.absSrcPath)}/*`],
          '@@/*': [`${tmpDir}/*`],
          ...(cormiPkgDir ? { cormi: [toTmpRelative(cormiPkgDir)] } : { cormi: [`${tmpDir}/exports.ts`] }),
        },
      },
      include: [
        `${toTmpRelative(api.cwd)}/.cormirc.ts`,
        `${toTmpRelative(api.cwd)}/.cormirc.*.ts`,
        `${toTmpRelative(api.cwd)}/config/*.ts`,
        `${toTmpRelative(api.cwd)}/mock/**/*.ts`,
        `${toTmpRelative(api.paths.absSrcPath)}/**/*.d.ts`,
        `${toTmpRelative(api.paths.absSrcPath)}/**/*.ts`,
        `${toTmpRelative(api.paths.absSrcPath)}/**/*.tsx`,
        `${tmpDir}/**/*.ts`,
        `${tmpDir}/**/*.tsx`,
        './typings.d.ts',
      ],
    }
    tsconfig = await api.applyPlugins({
      key: 'modifyTSConfig',
      type: api.ApplyPluginsType.modify,
      initialValue: tsconfig,
    })
    api.writeTmpFile({ noPluginDir: true, path: relative(api.paths.absTmpPath, tsconfigPath), content: JSON.stringify(tsconfig, null, 2) })
    api.writeTmpFile({ noPluginDir: true, path: relative(api.paths.absTmpPath, join(tsconfigDir, 'typings.d.ts')), content: TYPINGS })

    // cormi.ts, the client entry
    const entryCode = (await api.applyPlugins({ key: 'addEntryCode', initialValue: [] })).join('\n')
    const entryCodeAhead = (await api.applyPlugins({ key: 'addEntryCodeAhead', initialValue: [] })).join('\n')
    const importsAhead = importsToStr(await api.applyPlugins({
      key: 'addEntryImportsAhead',
      initialValue: [
        ...api.appData.globalCSS.map((source: string) => ({ source })),
        ...api.appData.globalJS.map((source: string) => ({ source })),
      ],
    })).join('\n')
    const imports = importsToStr(await api.applyPlugins({
      key: 'addEntryImports',
      initialValue: api.appData.overridesCSS.map((source: string) => ({ source })),
    })).join('\n')
    const polyfillImports = importsToStr(await api.applyPlugins({ key: 'addPolyfillImports', initialValue: [] })).join('\n')
    const json = (value: any) => JSON.stringify(value ?? null)
    const ssr = api.config.ssr
    api.writeTmpFile({
      noPluginDir: true,
      path: 'cormi.ts',
      tplPath: join(TEMPLATES_DIR, 'cormi.tpl'),
      context: {
        mountElementId: json(api.config.mountElementId),
        rendererPath,
        publicPath: json(api.config.publicPath),
        runtimePublicPath: api.config.runtimePublicPath ? 'true' : 'false',
        entryCode,
        entryCodeAhead,
        polyfillImports,
        importsAhead,
        imports,
        basename: json(api.config.base),
        historyType: json(api.config.history.type),
        hydrate: ssr ? 'true' : 'false',
        useStream: ssr?.useStream === false ? 'false' : 'true',
        reactRouter5Compat: api.config.reactRouter5Compat ? 'true' : 'false',
        loadingComponent: api.appData.globalLoading,
      },
    })

    // core/EmptyRoute.tsx: an empty route still passes the outlet context down
    api.writeTmpFile({
      noPluginDir: true,
      path: 'core/EmptyRoute.tsx',
      content: `
import React from 'react';
import { Outlet, useOutletContext } from '${rendererPath}';
export default function EmptyRoute() {
  const context = useOutletContext();
  return <Outlet context={context} />;
}
`,
    })

    // core/route.tsx
    const routes = api.appData.routes
    const clonedRoutes = lodash.cloneDeep(routes)
    for (const route of Object.values<any>(clonedRoutes)) {
      for (const key of Object.keys(route)) {
        // internal props, absolute paths and files stay on the server
        if (key.startsWith('__') || ['absPath', 'file'].includes(key)) delete route[key]
      }
    }
    const headerImports: string[] = [`import React from 'react';`]
    const routesString = JSON.stringify(clonedRoutes, null, 2)
    const routesPatches: string[] = []
    const withClientLoader = Object.values<any>(routes).filter(route => route.hasClientLoader)
    if (withClientLoader.length) {
      headerImports.push(`import clientLoaders from './loaders';`)
      for (const route of withClientLoader) {
        const id = JSON.stringify(route.id)
        routesPatches.push(`  routes[${id}].clientLoader = clientLoaders[${id}];`)
      }
      api.writeTmpFile({
        noPluginDir: true,
        path: 'core/loaders.ts',
        content: `export default {\n${withClientLoader.map(route => `  ${JSON.stringify(route.id)}: (args: any) => import('${route.__absFile}').then((m) => m.clientLoader(args)),`).join('\n')}\n} as Record<string, any>;`,
      })
    }
    const withRouteProps = Object.values<any>(routes).filter(route => route.hasRouteProps)
    if (withRouteProps.length) {
      headerImports.push(`import routeProps from './routeProps';`)
      // route props must not override the props the router relies on
      routesPatches.push(`  const internalProps = ['path', 'id', 'parentId', 'isLayout', 'isWrapper', 'layout', 'clientLoader'];`)
      for (const route of withRouteProps) {
        const id = JSON.stringify(route.id)
        routesPatches.push(`  for (const [key, value] of Object.entries(routeProps[${id}] || {})) {`)
        routesPatches.push(`    if (internalProps.includes(key)) throw new Error(\`[Cormi] route ${id} should not have '\${key}' prop in 'routeProps'.\`);`)
        routesPatches.push(`    routes[${id}][key] = value;`)
        routesPatches.push(`  }`)
      }
      api.writeTmpFile({
        noPluginDir: true,
        path: 'core/routeProps.ts',
        content: [
          ...withRouteProps.map((route, index) => `import { routeProps as p${index} } from '${route.__absFile}?cormi-route-props';`),
          `export default {`,
          ...withRouteProps.map((route, index) => `  ${JSON.stringify(route.id)}: p${index},`),
          `} as Record<string, any>;`,
        ].join('\n'),
      })
    }
    const routeComponents = Object.keys(routes).map((id) => {
      const route = routes[id]
      if (!route.file) {
        return `  ${JSON.stringify(id)}: React.lazy(() => import('./EmptyRoute')),`
      }
      // inline components, e.g. `component: () => <h1>foo</h1>` from plugins
      if (route.file.startsWith('(')) {
        return `  ${JSON.stringify(id)}: React.lazy(() => Promise.resolve(${route.file}).then((e) => (e?.default ? e : { default: e }))),`
      }
      const path = route.__absFile ?? route.file
      const chunkName = componentToChunkName(path, api.cwd)
      return `  ${JSON.stringify(id)}: React.lazy(() => import(/* webpackChunkName: "${chunkName}" */ '${winPath(path)}')),`
    })
    api.writeTmpFile({
      noPluginDir: true,
      path: 'core/route.tsx',
      tplPath: join(TEMPLATES_DIR, 'route.tpl'),
      context: {
        headerImports: headerImports.join('\n'),
        routes: routesString,
        routesPatches: routesPatches.join('\n'),
        routeComponents: `{\n${routeComponents.join('\n')}\n}`,
      },
    })

    // core/plugin.ts, the runtime plugins
    const plugins: string[] = await api.applyPlugins({
      key: 'addRuntimePlugin',
      initialValue: [api.appData.appJS?.path].filter(Boolean),
    })
    const validKeys: string[] = await api.applyPlugins({
      key: 'addRuntimePluginKey',
      initialValue: [...BUILTIN_RUNTIME_KEYS],
    })
    const duplicates = validKeys.filter((key, index) => validKeys.indexOf(key) !== index)
    if (duplicates.length) {
      throw new Error(`The plugin key cannot be duplicated. (${lodash.uniq(duplicates).join(', ')})`)
    }
    const appPluginRE = /(\/|\\)app\.(ts|tsx|jsx|js)$/
    api.writeTmpFile({
      noPluginDir: true,
      path: 'core/plugin.ts',
      tplPath: join(TEMPLATES_DIR, 'plugin.tpl'),
      context: {
        plugins: lodash.uniq(plugins).map((plugin, index) => ({
          index,
          // `export default defineApp({...})` in app.ts
          hasDefaultExport: appPluginRE.test(plugin),
          path: winPath(plugin),
        })),
        validKeys,
        rendererPath,
      },
    })

    // core/history.ts
    api.writeTmpFile({
      noPluginDir: true,
      path: 'core/history.ts',
      tplPath: join(TEMPLATES_DIR, 'history.tpl'),
      context: {
        historyPath: rendererPath,
        reactRouter5Compat: !!api.config.reactRouter5Compat,
      },
    })

    // server.ts: API routes, server loaders and SSR
    const apiRoutes = Object.values<any>(api.appData.apiRoutes ?? {})
    const needServer = !!ssr || apiRoutes.length > 0 || Object.values<any>(routes).some(route => route.hasServerLoader)
    api.appData.serverEntry = needServer ? winPath(join(api.paths.absTmpPath, 'server.ts')) : undefined
    if (needServer) {
      api.writeTmpFile({
        noPluginDir: true,
        path: 'server.ts',
        tplPath: join(TEMPLATES_DIR, 'server.tpl'),
        context: {
          serverPath,
          importsAhead: importsToStr(api.appData.globalJS.map((source: string) => ({ source }))).join('\n'),
          imports: '',
          apiRoutes: apiRoutes.map(route => ({ id: route.id, path: route.path, file: route.__absFile })),
          routeModules: Object.values<any>(routes)
            .filter(route => route.hasServerLoader)
            .map(route => ({ id: route.id, path: route.__absFile })),
          basename: json(api.config.base),
          mountElementId: json(api.config.mountElementId),
          ssr: ssr ? 'true' : 'false',
          useStream: ssr?.useStream === false ? 'false' : 'true',
          reactRouter5Compat: api.config.reactRouter5Compat ? 'true' : 'false',
          version: json(api.appData.cormi?.version),
        },
      })
    }
    void opts
  })

  function checkMembers(opts: { path: string; members: string[]; exportMembers: string[] }) {
    const conflicts = lodash.intersection(opts.exportMembers, opts.members)
    if (conflicts.length) {
      throw new Error(`Conflict members: ${conflicts.join(', ')} in ${opts.path}`)
    }
  }

  async function getExportsAndCheck(opts: { path: string; exportMembers: string[] }) {
    const members = (await getModuleExports({ file: opts.path })).filter(name => name !== 'default')
    checkMembers({ members, exportMembers: opts.exportMembers, path: opts.path })
    opts.exportMembers.push(...members)
    return members
  }

  // exports.ts: everything `import { ... } from 'cormi'` provides in the browser
  api.register({
    key: 'onGenerateFiles',
    stage: 10000,
    async fn() {
      const rendererPath: string = api.appData.rendererPath
      const beforeExports: string[] = []
      const exports: string[] = []
      const exportMembers = ['default']

      exports.push('// @cormi/renderer-react')
      const rendererMembers = await getExportsAndCheck({ path: getPackageEntry(rendererPath), exportMembers })
      exports.push(`export { ${rendererMembers.join(', ')} } from '${rendererPath}';`)
      exports.push(`export type { History, ClientLoader, ServerLoader, IRoute, IClientRoute, RouteComponentProps } from '${rendererPath}';`)

      exports.push('// core/history.ts')
      checkMembers({ members: ['history', 'createHistory'], exportMembers, path: '@@/core/history.ts' })
      exportMembers.push('history', 'createHistory')
      exports.push(`export { history, createHistory } from './core/history';`)
      exports.push(`export { getPluginManager } from './core/plugin';`)
      exportMembers.push('getPluginManager')

      // plugins: `plugin-<key>/index.ts(x)`, `types.d.ts`, `runtimeConfig.d.ts`
      beforeExports.push('// plugins')
      const absTmpPath = api.paths.absTmpPath
      const pluginDirs = existsSync(absTmpPath)
        ? readdirSync(absTmpPath).filter(file => file.startsWith('plugin-')).sort()
        : []
      for (const dir of pluginDirs) {
        const file = ['index.ts', 'index.tsx'].map(name => join(absTmpPath, dir, name)).find(existsSync)
        if (!file) continue
        const members = await getExportsAndCheck({ path: file, exportMembers })
        if (members.length) {
          beforeExports.push(`export { ${members.join(', ')} } from '${winPath(join(absTmpPath, dir))}';`)
        }
      }
      beforeExports.push('// plugins types.d.ts')
      for (const dir of pluginDirs) {
        const file = winPath(join(absTmpPath, dir, 'types.d.ts'))
        if (existsSync(file)) beforeExports.push(`export * from '${file.replace(/\.d\.ts$/, '')}';`)
      }
      let runtimeConfigType = 'export type RuntimeConfig = IDefaultRuntimeConfig'
      const beforeImport: string[] = []
      let index = 0
      for (const dir of pluginDirs) {
        const file = winPath(join(absTmpPath, dir, RUNTIME_TYPE_FILE_NAME))
        if (!existsSync(file)) continue
        beforeImport.push(`import type { IRuntimeConfig as Plugin${index} } from '${file.replace(/\.d\.ts$/, '')}'`)
        runtimeConfigType += ` & Plugin${index}`
        index++
      }
      api.writeTmpFile({
        noPluginDir: true,
        path: 'core/defineApp.ts',
        tplPath: join(TEMPLATES_DIR, 'defineApp.tpl'),
        context: { beforeImport: beforeImport.join('\n'), runtimeConfigType },
      })
      // `app.ts -> exports.ts -> plugin -> core/plugin.ts -> app.ts` is circular:
      // `defineApp` must come first
      beforeExports.unshift(
        '// defineApp',
        `export { defineApp } from './core/defineApp';`,
        `export type { RuntimeConfig } from './core/defineApp';`,
      )
      api.writeTmpFile({
        noPluginDir: true,
        path: 'exports.ts',
        content: [...beforeExports, ...exports].join('\n'),
      })
    },
  })
}
