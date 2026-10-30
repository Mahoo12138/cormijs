import { relative } from 'node:path'
import { init, parse } from 'es-module-lexer'
import type { ICheckCodeArgs } from '@cormi/core'
import type { Plugin } from 'vite'

type Import = ICheckCodeArgs['imports'][number]

/** Extract the specifiers of a static import statement. */
export function parseImportClause(statement: string): Pick<Import, 'default' | 'namespace' | 'specifiers' | 'kind'> {
  const result: Pick<Import, 'default' | 'namespace' | 'specifiers' | 'kind'> = { specifiers: {}, kind: 'value' }
  const match = /^import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]/.exec(statement.trim())
  if (!match) return result
  if (match[1]) result.kind = 'type'
  let clause = match[2].trim()
  const namespace = /\*\s+as\s+([\w$]+)/.exec(clause)
  if (namespace) {
    result.namespace = namespace[1]
    clause = clause.replace(namespace[0], '')
  }
  const named = /\{([\s\S]*?)\}/.exec(clause)
  if (named) {
    for (const part of named[1].split(',')) {
      const item = part.trim()
      if (!item) continue
      const isType = item.startsWith('type ')
      const [imported, local] = item.replace(/^type\s+/, '').split(/\s+as\s+/)
      result.specifiers[(local ?? imported).trim()] = {
        name: imported.trim(),
        kind: isType || result.kind === 'type' ? 'type' : 'value',
      }
    }
    clause = clause.replace(named[0], '')
  }
  const defaultName = clause.replace(/,/g, '').trim()
  if (defaultName) result.default = defaultName
  return result
}

export class CodeFrameError extends Error {
  loc?: any
  constructor(message: string, opts: { loc?: any } = {}) {
    super(message)
    this.name = 'CodeFrameError'
    this.loc = opts.loc
  }
}

/** Run `onCheckCode` for every transformed module of the app (not `node_modules`). */
export function checkCodePlugin(opts: {
  cwd: string
  absTmpPath: string
  checkCode: (args: Omit<ICheckCodeArgs, 'CodeFrameError'>) => Promise<void>
}): Plugin {
  return {
    name: 'cormi:check-code',
    enforce: 'post',
    async transform(code, id) {
      const file = id.split('?')[0]
      if (file.includes('/node_modules/') || file.startsWith('\0') || !file.startsWith(opts.cwd)) return
      if (!/\.[cm]?[jt]sx?$/.test(file)) return
      await init
      let imports: readonly any[]
      let exports: readonly any[]
      try {
        [imports, exports] = parse(code)
      } catch {
        return
      }
      try {
        await opts.checkCode({
          file,
          code,
          isFromTmp: file.startsWith(opts.absTmpPath),
          imports: imports
            .filter(item => item.d === -1 && item.n)
            .map(item => ({
              source: item.n!,
              loc: { start: item.ss, end: item.se },
              ...parseImportClause(code.slice(item.ss, item.se)),
            })),
          exports: exports.map(item => item.n),
          cjsExports: [],
        })
      } catch (error: any) {
        if (error instanceof CodeFrameError) {
          this.error({ message: `${error.message} (${relative(opts.cwd, file)})`, loc: error.loc })
        }
        throw error
      }
    },
  }
}
