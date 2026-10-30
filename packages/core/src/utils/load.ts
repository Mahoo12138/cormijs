import { unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { build, type Plugin as EsbuildPlugin } from 'esbuild'
import { winPath } from './path.ts'

export interface LoadedModule<T = any> {
  /** module namespace */
  exports: T
  /** absolute paths of every local file the module was built from, for watching */
  dependencies: string[]
}

const NATIVE_EXTENSIONS = ['.js', '.mjs', '.cjs']

const injectFileScope: EsbuildPlugin = {
  name: 'cormi:inject-file-scope',
  setup(build) {
    build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async (args) => {
      const { readFile } = await import('node:fs/promises')
      const contents = await readFile(args.path, 'utf8')
      const injectValues
        = `const __dirname = ${JSON.stringify(dirname(args.path))};`
        + `const __filename = ${JSON.stringify(args.path)};`
        + `const __cormi_import_meta_url = ${JSON.stringify(pathToFileURL(args.path).href)};`
      const ext = extname(args.path).slice(1)
      const loader = ext === 'mjs' || ext === 'cjs' ? 'js' : ext === 'mts' || ext === 'cts' ? 'ts' : ext
      return {
        loader: loader as any,
        contents: injectValues + contents,
      }
    })
  },
}

/**
 * Import a module freshly, regardless of the module cache.
 *
 * Local sources (TypeScript or not) are bundled with esbuild — dependencies
 * from `node_modules` stay external — then imported from a temporary file next
 * to the source, so bare imports resolve exactly as they would from the source.
 * This is how config files, local plugins and mock files are loaded, and why
 * editing them takes effect on the next load (umi achieves the same by
 * clearing `require.cache`).
 */
export async function loadModule<T = any>(file: string): Promise<LoadedModule<T>> {
  if (file.includes('/node_modules/') && NATIVE_EXTENSIONS.includes(extname(file))) {
    return {
      exports: await import(pathToFileURL(file).href),
      dependencies: [],
    }
  }

  const result = await build({
    absWorkingDir: dirname(file),
    entryPoints: [file],
    outfile: 'out.mjs',
    write: false,
    target: ['node22'],
    platform: 'node',
    bundle: true,
    format: 'esm',
    sourcemap: 'inline',
    metafile: true,
    packages: 'external',
    jsx: 'automatic',
    logLevel: 'silent',
    // ignore the project's tsconfig: its `paths` (e.g. `cormi`) would inline packages
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    define: {
      'import.meta.url': '__cormi_import_meta_url',
      'import.meta.dirname': '__dirname',
      'import.meta.filename': '__filename',
    },
    banner: {
      js: 'import { createRequire as __cormiCreateRequire } from "node:module"; const require = __cormiCreateRequire(import.meta.url);',
    },
    plugins: [injectFileScope],
  })

  const dependencies = Object.keys(result.metafile!.inputs)
    .filter(input => !input.includes(':'))
    .map(input => winPath(isAbsolute(input) ? input : resolve(dirname(file), input)))

  const code = result.outputFiles[0].text
  const temp = `${file}.timestamp-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.mjs`
  await writeFile(temp, code)
  try {
    return {
      exports: await import(pathToFileURL(temp).href),
      dependencies,
    }
  } finally {
    await unlink(temp).catch(() => {})
  }
}

/**
 * Unwrap the default export of a module namespace, handling the
 * `module.exports.__esModule` interop of transpiled CommonJS.
 */
export function unwrapDefault(exports: any) {
  if (exports === null || exports === undefined) return exports
  let value = 'default' in exports ? exports.default : exports
  if (value?.__esModule && 'default' in value) value = value.default
  return value
}
