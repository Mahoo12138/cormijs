import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getNpmClient, readJSON, resolvePackageDir, winPath } from '@cormi/core'
import type { IApi, IOnGenerateFiles } from '../../types.ts'
import { expandCSSPaths, expandJSPaths, findFirst, getActualFilePath } from '../../utils/files.ts'
import { getModuleExports } from '../../utils/getModuleExports.ts'
import { getApiRoutes, getRoutes } from '../tmpFiles/routes.ts'

const presetPkg = readJSON(join(dirname(fileURLToPath(import.meta.url)), '../../../package.json'))

function findGitDir(dir: string): string | undefined {
  while (true) {
    if (existsSync(join(dir, '.git'))) return join(dir, '.git')
    const parent = resolve(dir, '..')
    if (parent === dir) return
    dir = parent
  }
}

function getGitInfo(cwd: string) {
  const gitDir = findGitDir(cwd)
  if (!gitDir) return
  const git: Record<string, string> = {}
  const configPath = join(gitDir, 'config')
  if (existsSync(configPath)) {
    const match = /\[remote "origin"\][^[]*?url\s*=\s*(\S+)/.exec(readFileSync(configPath, 'utf8'))
    if (match) git.originUrl = match[1]
  }
  const headPath = join(gitDir, 'HEAD')
  if (existsSync(headPath)) {
    const head = readFileSync(headPath, 'utf8').trim()
    if (head.startsWith('ref: refs/heads/')) git.branch = head.slice(16)
  }
  return git
}

export default (api: IApi) => {
  async function getAppJsInfo() {
    for (const path of expandJSPaths(join(api.paths.absSrcPath, 'app'))) {
      if (!existsSync(path)) continue
      return { path: winPath(path), exports: await getModuleExports({ file: path }) }
    }
    return null
  }

  function getGlobalFiles() {
    const { absSrcPath } = api.paths
    const collect = (paths: string[]) => paths
      .filter(path => existsSync(path))
      .map(path => getActualFilePath(path) ?? winPath(path))
    return {
      globalCSS: collect(expandCSSPaths(join(absSrcPath, 'global'))),
      globalJS: collect(expandJSPaths(join(absSrcPath, 'global'))),
      overridesCSS: collect(expandCSSPaths(join(absSrcPath, 'overrides'))),
      globalLoading: findFirst(expandJSPaths(join(absSrcPath, 'loading'))),
    }
  }

  function getDepInfo(name: string) {
    const dir = resolvePackageDir(name, api.cwd)
      ?? resolvePackageDir(name, dirname(fileURLToPath(import.meta.url)))
    if (!dir) return
    return { version: readJSON(join(dir, 'package.json'))?.version as string, path: winPath(dir) }
  }

  api.modifyAppData(async (memo) => {
    memo.routes = await getRoutes({ api })
    memo.apiRoutes = getApiRoutes({ api })
    memo.hasSrcDir = api.paths.absSrcPath.endsWith('/src')
    memo.npmClient = api.userConfig.npmClient || getNpmClient({ cwd: api.cwd })
    memo.cormi = {
      version: presetPkg?.version,
      name: 'Cormi',
      importSource: 'cormi',
      cliName: 'cormi',
    }
    memo.bundleStatus = { done: false }
    memo.react = getDepInfo('react')
    memo['react-dom'] = getDepInfo('react-dom')
    memo.appJS = await getAppJsInfo()
    Object.assign(memo, getGlobalFiles())
    memo.git = getGitInfo(api.cwd)
    memo.framework = 'react'
    memo.bundler = api.config.bundler ?? 'vite'
    const typescript = getDepInfo('typescript')
    memo.typescript = { tsVersion: typescript?.version, tslibVersion: getDepInfo('tslib')?.version }
    memo.locale = Intl.DateTimeFormat().resolvedOptions().locale
    return memo
  })

  // run first, so that other `onGenerateFiles` hooks see fresh data
  api.register({
    key: 'onGenerateFiles',
    async fn(args: IOnGenerateFiles) {
      if (!args.isFirstTime) {
        api.appData.appJS = await getAppJsInfo()
        Object.assign(api.appData, getGlobalFiles())
        api.appData.routes = await getRoutes({ api })
        api.appData.apiRoutes = getApiRoutes({ api })
      }
      api.writeTmpFile({
        noPluginDir: true,
        path: 'appData.json',
        content: JSON.stringify(serializeAppData(api.appData), null, 2),
      })
    },
    stage: Number.NEGATIVE_INFINITY,
  })
}

/** A JSON view of appData, without the heavy / circular fields. */
export function serializeAppData(appData: Record<string, any>) {
  const { plugins, presets, ...rest } = appData
  const routes = Object.fromEntries(Object.entries(rest.routes ?? {}).map(([id, route]: [string, any]) => {
    const clean = Object.fromEntries(Object.entries(route).filter(([key]) => !key.startsWith('__')))
    return [id, clean]
  }))
  return {
    ...rest,
    routes,
    apiRoutes: Object.fromEntries(Object.entries(rest.apiRoutes ?? {}).map(([id, route]: [string, any]) => [id, { id, path: route.path, file: route.file }])),
    plugins: Object.keys(plugins ?? {}),
  }
}
