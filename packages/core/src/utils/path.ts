import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve as esmResolve } from 'import-meta-resolve'
import { RESOLVE_EXTENSIONS } from '../constants.ts'

export function winPath(path: string) {
  const isExtendedLengthPath = /^\\\\\?\\/.test(path)
  if (isExtendedLengthPath) return path
  return path.replace(/\\/g, '/')
}

export function isFile(path: string) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

export function isDirectory(path: string) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Return the first path that exists. */
export function tryPaths(paths: string[]) {
  for (const path of paths) {
    if (existsSync(path)) return path
  }
}

/** Expand `base` into `base.{ext}` candidates. */
export function expandExtensions(base: string, extensions = RESOLVE_EXTENSIONS) {
  return extensions.map(ext => `${base}${ext}`)
}

function tryFile(path: string, extensions: string[]): string | undefined {
  if (isFile(path)) return path
  for (const ext of extensions) {
    if (isFile(path + ext)) return path + ext
  }
  if (isDirectory(path)) {
    const pkgPath = join(path, 'package.json')
    if (isFile(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (pkg.main) {
        const main = tryFile(join(path, pkg.main), extensions)
        if (main) return main
      }
    }
    for (const ext of extensions) {
      const index = join(path, 'index' + ext)
      if (isFile(index)) return index
    }
  }
  return undefined
}

/**
 * Resolve a module specifier like node would, anchored at `basedir`.
 *
 * - relative / absolute paths may omit the extension or point to a directory
 * - bare specifiers use ESM resolution (honoring `exports`), then fall back to CJS
 */
export function resolveModule(specifier: string, basedir: string, extensions = RESOLVE_EXTENSIONS): string {
  if (specifier.startsWith('file://')) specifier = fileURLToPath(specifier)
  if (isAbsolute(specifier) || specifier.startsWith('./') || specifier.startsWith('../') || specifier === '.' || specifier === '..') {
    const found = tryFile(resolve(basedir, specifier), extensions)
    if (!found) throw new Error(`Cannot resolve "${specifier}" from ${basedir}`)
    return found
  }
  const parent = pathToFileURL(join(basedir, '__cormi_resolve__.js')).href
  let esmError: unknown
  try {
    const url = esmResolve(specifier, parent)
    if (url.startsWith('file:')) return fileURLToPath(url)
    return url
  } catch (error) {
    esmError = error
  }
  try {
    return createRequire(parent).resolve(specifier)
  } catch {
    throw esmError
  }
}

/** Like {@link resolveModule} but returns `undefined` instead of throwing. */
export function tryResolveModule(specifier: string, basedir: string, extensions?: string[]) {
  try {
    return resolveModule(specifier, basedir, extensions)
  } catch {}
}

/** Find the nearest `package.json` at or above `from` (a file or a directory). */
export function findPackageJSON(from: string): string | undefined {
  let dir = isDirectory(from) ? from : dirname(from)
  while (true) {
    const file = join(dir, 'package.json')
    if (isFile(file)) return file
    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}

/** Resolve the directory of an installed package as seen from `basedir`. */
export function resolvePackageDir(name: string, basedir: string): string | undefined {
  const entry = tryResolveModule(`${name}/package.json`, basedir)
  if (entry) return dirname(entry)
  const main = tryResolveModule(name, basedir)
  if (!main) return
  let dir = dirname(main)
  while (true) {
    const pkgPath = join(dir, 'package.json')
    if (isFile(pkgPath) && readJSON(pkgPath)?.name === name) return dir
    const parent = dirname(dir)
    if (parent === dir) return
    dir = parent
  }
}

export function readJSON<T = any>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {}
}
