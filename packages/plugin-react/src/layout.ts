import { CormiError, type Plugin } from '@cormijs/core';
import { moduleRef, projectPath, type ModuleRef } from '@cormijs/routes';
import { lstat } from 'node:fs/promises';
import type {} from './index.js';

export interface LayoutContribution {
  readonly id: string;
  readonly files: readonly string[];
}
export interface GlobalLayoutPlan {
  readonly owner: string;
  readonly module: ModuleRef;
}
export const DEFAULT_LAYOUT_FILES = Object.freeze(['src/layouts/index.tsx', 'src/layouts/index.jsx', 'src/layouts/index.ts', 'src/layouts/index.js']);

function layoutFiles(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || !value.length || value.length > 16 || value.some(file =>
    typeof file !== 'string' || !file || file.length > 512 || /[\0\r\n?#%\\]/.test(file) || file.startsWith('/')
    || !/\.[jt]sx?$/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')))) {
    throw new CormiError('LAYOUT_INVALID', `${field} must list project-relative runtime source files.`);
  }
  return Object.freeze([...(value as string[])]);
}

export function layoutContributions(input: unknown): readonly LayoutContribution[] {
  if (!Array.isArray(input) || input.length > 8) throw new CormiError('LAYOUT_INVALID', 'Expected at most 8 layout contributions.');
  const ids = new Set<string>();
  return Object.freeze(input.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CormiError('LAYOUT_INVALID', 'Expected a layout contribution.');
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some(key => !['id', 'files'].includes(key)) || typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(item.id) || ids.has(item.id)) {
      throw new CormiError('LAYOUT_INVALID', 'Invalid or duplicate layout contribution id.');
    }
    ids.add(item.id);
    return Object.freeze({ id: item.id, files: layoutFiles(item.files, 'files') });
  }));
}

export function layoutFilesToWatch(sources: readonly LayoutContribution[]): string[] {
  return sources.flatMap(source => source.files);
}

/** Resolve the single existing global layout; missing candidates are inactive, not errors. */
export async function resolveGlobalLayout(root: string, sources: readonly LayoutContribution[]): Promise<GlobalLayoutPlan | undefined> {
  const found: Array<{ owner: string; module: ModuleRef }> = [];
  for (const source of sources) {
    for (const file of source.files) {
      try {
        const info = await lstat(projectPath(root, file));
        if (!info.isFile() || info.isSymbolicLink()) throw new CormiError('CLIENT_MODULE_INVALID', 'Global layout must be an ordinary source file.', { file });
        found.push({ owner: source.id, module: moduleRef({ specifier: './' + file, exportName: 'default' }) });
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  if (found.length > 1) throw new CormiError('LAYOUT_CONFLICT', 'Only one global layout module may be active.', { files: found.map(item => item.module.specifier) });
  return found[0] ? Object.freeze(found[0]) : undefined;
}

export interface LayoutPluginOptions {
  readonly id?: string;
  readonly files?: readonly string[];
}
/** Opt-in convention: one global layout from src/layouts/index.* wrapping the application routes. */
export const layoutPlugin: Plugin.Object<LayoutPluginOptions> = {
  name: 'cormi:layout', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'files'].includes(key))) {
      throw new CormiError('LAYOUT_INVALID', 'Invalid layout plugin options.');
    }
    const id = options.id ?? 'cormi:layout';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('LAYOUT_INVALID', 'Invalid layout id.');
    const contribution = layoutContributions([{ id, files: options.files ?? DEFAULT_LAYOUT_FILES }])[0]!;
    ctx.effect(() => ctx.react.layouts.tap({ id: id + ':layout', owner: id, ownerOrder: 0, run: () => [contribution] }));
  },
};
