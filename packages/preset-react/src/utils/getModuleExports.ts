import { readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { init, parse } from 'es-module-lexer'
import { transformSync } from 'esbuild'

const cache = new Map<string, { content: string; exports: string[] }>()

/** Named exports of a JS / TS module, found statically (es-module-lexer after an esbuild transform). */
export async function getModuleExports(opts: { file: string; content?: string }): Promise<string[]> {
  const content = opts.content ?? readFileSync(opts.file, 'utf8')
  const cached = cache.get(opts.file)
  if (cached?.content === content) return cached.exports
  await init
  const ext = extname(opts.file).slice(1)
  const loader = ext === 'mts' || ext === 'cts' ? 'ts' : ext === 'mjs' || ext === 'cjs' ? 'js' : ext as 'ts'
  let exports: string[] = []
  try {
    const { code } = transformSync(content, { loader, format: 'esm', jsx: 'automatic', target: 'esnext' })
    exports = parse(code)[1].map(item => item.n)
  } catch {
    return []
  }
  cache.set(opts.file, { content, exports })
  return exports
}
