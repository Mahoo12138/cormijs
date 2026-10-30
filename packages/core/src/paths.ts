import { join } from 'node:path'
import { Env } from './types.ts'
import { isDirectory, winPath } from './utils/path.ts'

function winJoin(...args: string[]) {
  return winPath(join(...args))
}

export interface Paths {
  cwd: string
  absSrcPath: string
  absPagesPath: string
  absApiRoutesPath: string
  absTmpPath: string
  absNodeModulesPath: string
  absOutputPath: string
}

export function getPaths(opts: { cwd: string; prefix: string; env: Env | `${Env}` }): Paths {
  const cwd = winPath(opts.cwd)
  const src = winJoin(cwd, 'src')
  const absSrcPath = isDirectory(src) ? src : cwd
  const absPagesPath = winJoin(absSrcPath, 'pages')
  const absApiRoutesPath = winJoin(absSrcPath, 'api')
  const tmp = opts.env === Env.development
    ? `.${opts.prefix}`
    : `.${opts.prefix}-${opts.env}`
  const absTmpPath = winJoin(absSrcPath, tmp)
  const absNodeModulesPath = winJoin(cwd, 'node_modules')
  const absOutputPath = winJoin(cwd, 'dist')
  return {
    cwd,
    absSrcPath,
    absPagesPath,
    absApiRoutesPath,
    absTmpPath,
    absNodeModulesPath,
    absOutputPath,
  }
}
