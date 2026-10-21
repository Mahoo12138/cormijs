import { CormiError, type Plugin } from '@cormijs/core';
import { cp, lstat, mkdir, realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {} from '@cormijs/plugin-vite';

export interface OutputCopy { readonly from: string; readonly to?: string }
export interface OutputPluginOptions {
  readonly id?: string;
  /** Project-relative files or directories copied into the build output after bundling. */
  readonly copy?: readonly OutputCopy[];
  /** `false` keeps stable, unhashed asset names; defaults to Vite's hashed names. */
  readonly hash?: boolean;
}
const relativePath = (value: unknown, max: number): value is string => typeof value === 'string' && value.length > 0 && value.length <= max
  && !isAbsolute(value) && !/[\0\r\n?#%\\]/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..' && !part.startsWith('.'));

export function resolveOutputCopy(root: string, input: unknown): readonly OutputCopy[] {
  if (input === undefined) return Object.freeze([]);
  if (!Array.isArray(input) || !input.length || input.length > 32) throw new CormiError('OUTPUT_INVALID', 'copy must contain 1 to 32 entries.');
  return Object.freeze(input.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new CormiError('OUTPUT_INVALID', 'Invalid copy entry.', { index });
    const row = entry as Record<string, unknown>;
    if (Object.keys(row).some(key => !['from', 'to'].includes(key)) || !relativePath(row.from, 1024)) throw new CormiError('OUTPUT_INVALID', 'copy.from must be a project-relative path.', { index });
    if (row.to !== undefined && !relativePath(row.to, 1024)) throw new CormiError('OUTPUT_INVALID', 'copy.to must be a project-relative path.', { index });
    const source = resolve(root, row.from), local = relative(root, source);
    if (!local || local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) throw new CormiError('OUTPUT_INVALID', 'copy.from escapes the project.', { index });
    if (/(?:^|[\\/])(?:node_modules|\.cormi[^\\/]*|\.env(?:\\.|$))/.test(source)) throw new CormiError('OUTPUT_INVALID', 'copy.from cannot reference private or generated files.', { index });
    return Object.freeze({ from: row.from, ...(row.to !== undefined ? { to: row.to as string } : { to: basename(row.from) }) });
  }));
}

/** Stable output names keep every asset under `assets/<name><ext>` so deployments can cache by URL. */
export function stableOutputNames() {
  return Object.freeze({
    entryFileNames: 'assets/[name].js',
    chunkFileNames: 'assets/[name].js',
    assetFileNames: 'assets/[name][extname]',
  });
}

async function copyInto(root: string, output: string, copies: readonly OutputCopy[]) {
  for (const copy of copies) {
    const source = resolve(root, copy.from), target = resolve(output, copy.to!);
    if (!target.startsWith(output + sep)) throw new CormiError('OUTPUT_INVALID', 'copy.to escapes the output directory.', { to: copy.to });
    const info = await lstat(source).catch((error: NodeJS.ErrnoException) => { throw error.code === 'ENOENT' ? new CormiError('OUTPUT_INVALID', 'copy.from does not exist.', { from: copy.from }) : error; });
    const real = await realpath(source), realRoot = await realpath(root);
    if (real !== source || !real.startsWith(realRoot + sep)) throw new CormiError('OUTPUT_INVALID', 'copy.from must be a real path inside the project.', { from: copy.from });
    if (info.isSymbolicLink()) throw new CormiError('OUTPUT_INVALID', 'copy.from cannot be a symbolic link.', { from: copy.from });
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: info.isDirectory(), force: true, errorOnExist: false, dereference: false });
    await stat(target);
  }
}

/** Opt-in build policy: stable asset names and/or extra files copied into the published directory. */
export const outputPlugin: Plugin.Object<OutputPluginOptions> = {
  name: 'cormi:output', inject: ['vite', 'projectRoot'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'copy', 'hash'].includes(key))) {
      throw new CormiError('OUTPUT_INVALID', 'Invalid output plugin options.');
    }
    const id = options.id ?? 'cormi:output';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('OUTPUT_INVALID', 'Invalid output plugin id.');
    if (options.hash !== undefined && typeof options.hash !== 'boolean') throw new CormiError('OUTPUT_INVALID', 'hash must be a boolean.');
    const copies = resolveOutputCopy(ctx.projectRoot.root, options.copy);
    if (!copies.length && options.hash === undefined) throw new CormiError('OUTPUT_INVALID', 'Configure copy or hash.');
    const root = ctx.projectRoot.root;
    let output = '';
    ctx.effect(() => ctx.vite.add(id, () => ({
      name: id, apply: 'build',
      config(config) {
        if (options.hash !== false) return {};
        const existing = config.build?.rollupOptions?.output;
        if (existing !== undefined && (Array.isArray(existing) || Object.keys(existing).some(key => ['entryFileNames', 'chunkFileNames', 'assetFileNames'].includes(key)))) {
          throw new CormiError('OUTPUT_INVALID', 'hash: false cannot be combined with custom output file names.');
        }
        return { build: { rollupOptions: { output: stableOutputNames() } } };
      },
      configResolved(resolved) { output = resolved.build.outDir; },
      async closeBundle() { if (copies.length && output) await copyInto(root, output, copies); },
    })));
  },
};
