import { build, type Loader } from 'esbuild';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CormiError } from '@cormijs/core';

export class ConfigCompileError extends CormiError {
  constructor(message: string, readonly files: readonly string[], cause?: unknown) {
    super('CONFIG_COMPILE_FAILED', message, {}, { cause });
  }
}
export { fingerprint } from './inputs.js';
import { fingerprint } from './inputs.js';
export interface CompiledConfig { readonly code: string; readonly files: readonly string[]; readonly fingerprint: string }
/** Static compilation runs in the supervisor; user configuration is evaluated only in a fresh worker. */
export async function compileConfig(root: string): Promise<CompiledConfig> {
  const entry = join(root, 'cormi.config.ts');
  const files = new Set<string>([entry, join(root, 'package.json'), join(root, 'pnpm-lock.yaml'), join(root, '.env')]);
  const loaded = new Map<string, string>();
  function inside(path: string): boolean {
    const rel = relative(root, path); return !!rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  }
  try {
    const result = await build({
      absWorkingDir: root, entryPoints: [entry], bundle: true, packages: 'external', platform: 'node',
      target: 'node22', format: 'esm', write: false, metafile: true, sourcemap: 'inline', sourcesContent: false,
      outfile: join(root, '.cormi', 'config.mjs'), logLevel: 'silent', tsconfigRaw: { compilerOptions: {} },
      define: { 'import.meta.url': '__cormi_source_url__', 'import.meta.dirname': '__cormi_source_dir__', 'import.meta.filename': '__cormi_source_file__' },
      banner: { js: "import { createRequire as __cormi_create_require__ } from 'node:module'; const require = __cormi_create_require__(import.meta.url);" },
      plugins: [{ name: 'cormi:config-inputs', setup(build) {
        build.onResolve({ filter: /^\./ }, args => {
          if (!args.resolveDir) return;
          const base = resolve(args.resolveDir, args.path);
          if (!inside(base)) throw new Error(`Local config import is outside the project: ${args.path}`);
          for (const suffix of ['', '.ts', '.tsx', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json', '/index.ts', '/index.js']) files.add(base + suffix);
          return undefined;
        });
        build.onLoad({ filter: /\.(?:[cm]?[jt]s|[jt]sx|json)$/ }, async args => {
          const sourcePath = await realpath(args.path);
          if (!inside(sourcePath)) throw new Error(`Config dependency is outside the project: ${args.path}`);
          const source = await readFile(args.path, 'utf8'); files.add(args.path); files.add(sourcePath);
          loaded.set(args.path, createHash('sha256').update(source).digest('hex'));
          const ext = extname(args.path).slice(1);
          const loader: Loader = ext === 'json' ? 'json' : ext === 'tsx' ? 'tsx' : ext === 'jsx' ? 'jsx' : ext.endsWith('ts') ? 'ts' : 'js';
          const prelude = loader === 'json' ? '' : `const __cormi_source_url__ = ${JSON.stringify(pathToFileURL(args.path).href)}; const __cormi_source_dir__ = ${JSON.stringify(dirname(args.path))}; const __cormi_source_file__ = ${JSON.stringify(args.path)};\n`;
          return { contents: prelude + source, loader, resolveDir: dirname(args.path) };
        });
      } }],
    });
    const list = [...files].sort();
    const baseline = await fingerprint(list);
    for (const [file, digest] of loaded) {
      const now = createHash('sha256').update(await readFile(file)).digest('hex');
      if (now !== digest) throw new CormiError('CONFIG_CHANGED', 'Configuration changed while being compiled.');
    }
    const code = result.outputFiles?.[0]?.text;
    if (!code) throw new Error('Compiler produced no config module');
    if (list.length > 4096) throw new Error('Configuration dependency graph is too large');
    if (await fingerprint(list) !== baseline) throw new CormiError('CONFIG_CHANGED', 'Configuration changed during input verification.');
    return { code, files: list, fingerprint: baseline };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new ConfigCompileError(message, [...files].sort(), cause);
  }
}
