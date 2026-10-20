import { CormiError, type Plugin } from '@cormijs/core';
import { moduleRef, projectPath, type ModuleRef } from '@cormijs/routes';
import { lstat, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import type {} from './index.js';

export interface ModelContribution {
  readonly id: string;
  readonly dir?: string;
  readonly files?: readonly string[];
}
export interface ModelPlan {
  readonly namespace: string;
  readonly module: ModuleRef;
}
export const DEFAULT_MODEL_DIR = 'src/models';

const name = (file: string) => file.split('/').at(-1)!.replace(/\.[cm]?[jt]sx?$/, '').replace(/\.model$/, '');
const namespaceOf = (file: string) => {
  const parts = file.split('/'), base = name(parts.pop()!);
  const dirs = parts.filter(part => !['src', 'pages', 'models'].includes(part));
  return [...dirs, base].join('.');
};
const sourceFile = (value: unknown, field: string) => {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\0\r\n?#%\\]/.test(value) || value.startsWith('/')
    || !/\.[cm]?[jt]sx?$/.test(value) || /\.d\.[cm]?[jt]sx?$/.test(value)
    || value.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new CormiError('MODEL_INVALID', `${field} must be a project-relative runtime source file.`);
  }
  return value;
};
const sourceDir = (value: unknown) => {
  if (typeof value !== 'string' || !value || value.length > 512 || /[\0\r\n?#%\\]/.test(value) || value.startsWith('/')
    || value.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    throw new CormiError('MODEL_INVALID', 'Model directory must be project-relative.');
  }
  return value.replace(/\/$/, '');
};

export function modelContributions(input: unknown): readonly ModelContribution[] {
  if (!Array.isArray(input) || input.length > 8) throw new CormiError('MODEL_INVALID', 'Expected at most 8 model contributions.');
  const ids = new Set<string>();
  return Object.freeze(input.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CormiError('MODEL_INVALID', 'Expected a model contribution.');
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some(key => !['id', 'dir', 'files'].includes(key)) || typeof item.id !== 'string'
      || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(item.id) || ids.has(item.id)) {
      throw new CormiError('MODEL_INVALID', 'Invalid or duplicate model contribution id.');
    }
    ids.add(item.id);
    if (item.dir !== undefined && item.files !== undefined) throw new CormiError('MODEL_INVALID', 'A model source must choose a directory or files.');
    if (item.files !== undefined) {
      if (!Array.isArray(item.files) || !item.files.length || item.files.length > 256) throw new CormiError('MODEL_INVALID', 'Model files must be a non-empty bounded source list.');
      return Object.freeze({ id: item.id, files: Object.freeze(item.files.map(file => sourceFile(file, 'files'))) });
    }
    return Object.freeze({ id: item.id, dir: sourceDir(item.dir ?? DEFAULT_MODEL_DIR) });
  }));
}

export function modelWatchPaths(sources: readonly ModelContribution[]): string[] {
  return sources.flatMap(source => source.files ? [...source.files] : [source.dir!]);
}

async function walk(root: string, directory: string, out: string[], depth: number): Promise<void> {
  if (depth > 32) throw new CormiError('MODEL_INVALID', 'Model directory exceeds the supported depth.');
  const absolute = projectPath(root, directory);
  let info;
  try { info = await lstat(absolute); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  if (info.isSymbolicLink()) throw new CormiError('MODEL_INVALID', 'Model directories cannot contain symbolic links.', { file: directory });
  if (!info.isDirectory()) throw new CormiError('MODEL_INVALID', 'Model directory is not a directory.', { file: directory });
  for (const child of (await readdir(absolute)).sort()) {
    if (child.startsWith('.') || /\.(test|spec)\./.test(child) || /\.d\.[cm]?[jt]sx?$/.test(child)) continue;
    const file = join(directory, child), local = relative(root, join(absolute, child)).split(sep).join('/');
    const state = await lstat(join(absolute, child));
    if (state.isSymbolicLink()) throw new CormiError('MODEL_INVALID', 'Model directories cannot contain symbolic links.', { file: local });
    if (state.isDirectory()) await walk(root, local, out, depth + 1);
    else if (state.isFile() && /\.[cm]?[jt]sx?$/.test(child)) out.push(local);
  }
}

export async function modelFiles(root: string, sources: readonly ModelContribution[]): Promise<string[]> {
  const files: string[] = [];
  for (const source of sources) {
    if (source.files) files.push(...source.files);
    else await walk(root, source.dir!, files, 0);
  }
  return [...new Set(files)].sort();
}

/** Resolve model modules; the stable filename-derived namespace is public application API. */
export async function resolveModels(root: string, sources: readonly ModelContribution[]): Promise<readonly ModelPlan[]> {
  const files = await modelFiles(root, sources), namespaces = new Set<string>(), plans: ModelPlan[] = [];
  for (const file of files) {
    const info = await lstat(projectPath(root, file));
    if (!info.isFile() || info.isSymbolicLink()) throw new CormiError('MODEL_INVALID', 'Model must be an ordinary source file.', { file });
    const namespace = namespaceOf(file);
    if (!/^[A-Za-z_$][A-Za-z0-9_$.-]*$/.test(namespace)) throw new CormiError('MODEL_INVALID', 'Model namespace is invalid.', { file, namespace });
    if (namespaces.has(namespace)) throw new CormiError('MODEL_CONFLICT', `Duplicate model namespace: ${namespace}`, { namespace });
    namespaces.add(namespace);
    plans.push({ namespace, module: moduleRef({ specifier: './' + file, exportName: 'default' }) });
  }
  plans.sort((a, b) => a.namespace < b.namespace ? -1 : a.namespace > b.namespace ? 1 : 0);
  return Object.freeze(plans);
}

export interface ModelPluginOptions {
  readonly id?: string;
  readonly dir?: string;
  readonly files?: readonly string[];
}
/** Opt-in convention: model hook modules under src/models, shared per application mount. */
export const modelPlugin: Plugin.Object<ModelPluginOptions> = {
  name: 'cormi:model', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'dir', 'files'].includes(key))) {
      throw new CormiError('MODEL_INVALID', 'Invalid model plugin options.');
    }
    const id = options.id ?? 'cormi:model';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('MODEL_INVALID', 'Invalid model id.');
    const contribution = modelContributions([{ id, ...(options.dir === undefined ? {} : { dir: options.dir }), ...(options.files === undefined ? {} : { files: options.files }) }])[0]!;
    ctx.effect(() => ctx.react.models.tap({ id: id + ':models', owner: id, ownerOrder: 0, run: () => [contribution] }));
  },
};
