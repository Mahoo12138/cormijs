import { CormiError, type Plugin } from '@cormijs/core';
import { moduleRef, projectPath, type ModuleRef } from '@cormijs/routes';
import { lstat } from 'node:fs/promises';
import type {} from './index.js';

export interface LoadingContribution {
  readonly id: string;
  readonly files: readonly string[];
}
export interface GlobalLoadingPlan {
  readonly owner: string;
  readonly module: ModuleRef;
}
export const DEFAULT_LOADING_FILES = Object.freeze(['src/loading.tsx', 'src/loading.jsx', 'src/loading.ts', 'src/loading.js']);

function loadingFiles(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.length || value.length > 16 || value.some(file =>
    typeof file !== 'string' || !file || file.length > 512 || /[\0\r\n?#%\\]/.test(file) || file.startsWith('/')
    || !/\.[jt]sx?$/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')))) {
    throw new CormiError('LOADING_INVALID', 'Loading files must be project-relative runtime source files.');
  }
  return Object.freeze([...(value as string[])]);
}

export function loadingContributions(input: unknown): readonly LoadingContribution[] {
  if (!Array.isArray(input) || input.length > 8) throw new CormiError('LOADING_INVALID', 'Expected at most 8 loading contributions.');
  const ids = new Set<string>();
  return Object.freeze(input.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CormiError('LOADING_INVALID', 'Expected a loading contribution.');
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some(key => !['id', 'files'].includes(key)) || typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(item.id) || ids.has(item.id)) {
      throw new CormiError('LOADING_INVALID', 'Invalid or duplicate loading contribution id.');
    }
    ids.add(item.id);
    return Object.freeze({ id: item.id, files: loadingFiles(item.files) });
  }));
}

export function loadingFilesToWatch(sources: readonly LoadingContribution[]): string[] {
  return sources.flatMap(source => source.files);
}

/** Resolve the single existing loading component; missing candidates are inactive. */
export async function resolveGlobalLoading(root: string, sources: readonly LoadingContribution[]): Promise<GlobalLoadingPlan | undefined> {
  const found: Array<{ owner: string; module: ModuleRef }> = [];
  for (const source of sources) {
    for (const file of source.files) {
      try {
        const info = await lstat(projectPath(root, file));
        if (!info.isFile() || info.isSymbolicLink()) throw new CormiError('CLIENT_MODULE_INVALID', 'Loading component must be an ordinary source file.', { file });
        found.push({ owner: source.id, module: moduleRef({ specifier: './' + file, exportName: 'default' }) });
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  if (found.length > 1) throw new CormiError('LOADING_CONFLICT', 'Only one loading component may be active.', { files: found.map(item => item.module.specifier) });
  return found[0] ? Object.freeze(found[0]) : undefined;
}

export interface LoadingPluginOptions {
  readonly id?: string;
  readonly files?: readonly string[];
}
/** Opt-in convention: one loading component from src/loading.* used while the initial route resolves. */
export const loadingPlugin: Plugin.Object<LoadingPluginOptions> = {
  name: 'cormi:loading', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'files'].includes(key))) {
      throw new CormiError('LOADING_INVALID', 'Invalid loading plugin options.');
    }
    const id = options.id ?? 'cormi:loading';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('LOADING_INVALID', 'Invalid loading id.');
    const contribution = loadingContributions([{ id, files: options.files ?? DEFAULT_LOADING_FILES }])[0]!;
    ctx.effect(() => ctx.react.loading.tap({ id: id + ':loading', owner: id, ownerOrder: 0, run: () => [contribution] }));
  },
};
