import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { expandExtensions, winPath } from '@cormi/core'

export const JS_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js']
export const CSS_EXTENSIONS = ['.css', '.less', '.scss', '.sass', '.styl', '.stylus']

export function expandJSPaths(base: string) {
  return expandExtensions(base, JS_EXTENSIONS)
}

export function expandCSSPaths(base: string) {
  return expandExtensions(base, CSS_EXTENSIONS)
}

/** The real path of a file, with the case of the file system (`Global.css` vs `global.css`). */
export function getActualFilePath(filePath: string) {
  const dir = dirname(filePath)
  if (!existsSync(dir)) return
  const lowerBase = basename(filePath).toLowerCase()
  const matched = readdirSync(dir).find(file => file.toLowerCase() === lowerBase)
  return matched ? winPath(join(dir, matched)) : undefined
}

export function findFirst(paths: string[]) {
  for (const path of paths) {
    if (existsSync(path)) return getActualFilePath(path) ?? winPath(path)
  }
}

/** Shorten an absolute path to `@/...` (src) when possible, for readable generated code. */
export function toImportPath(file: string) {
  return winPath(file)
}
