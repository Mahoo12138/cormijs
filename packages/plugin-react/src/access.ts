import { CormiError, type Plugin } from '@cormijs/core';
import { moduleRef, projectPath, type ModuleRef } from '@cormijs/routes';
import { lstat } from 'node:fs/promises';
import type { AppConfigContribution } from './app-runtime.js';
import type { RuntimeContribution } from './generate.js';
import type {} from './index.js';

export interface AccessContribution {
  readonly id: string;
  readonly files: readonly string[];
}
export interface AccessPlan {
  readonly owner: string;
  readonly module: ModuleRef;
}
export const DEFAULT_ACCESS_FILES = Object.freeze(['src/access.ts', 'src/access.tsx']);
export interface AccessPluginOptions {
  readonly id?: string;
  readonly files?: readonly string[];
}

function accessFiles(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.length || value.length > 16 || value.some(file =>
    typeof file !== 'string' || !file || file.length > 512 || /[\0\r\n?#%\\]/.test(file) || file.startsWith('/')
    || !/\.[jt]sx?$/.test(file) || file.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')))) {
    throw new CormiError('ACCESS_INVALID', 'Access files must be project-relative runtime source files.');
  }
  return Object.freeze([...(value as string[])]);
}

export function accessContributions(input: unknown): readonly AccessContribution[] {
  if (!Array.isArray(input) || input.length > 8) throw new CormiError('ACCESS_INVALID', 'Expected at most 8 access contributions.');
  const ids = new Set<string>();
  return Object.freeze(input.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CormiError('ACCESS_INVALID', 'Expected an access contribution.');
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some(key => !['id', 'files'].includes(key)) || typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(item.id) || ids.has(item.id)) {
      throw new CormiError('ACCESS_INVALID', 'Invalid or duplicate access contribution id.');
    }
    ids.add(item.id);
    return Object.freeze({ id: item.id, files: accessFiles(item.files) });
  }));
}

export function accessFilesToWatch(sources: readonly AccessContribution[]): string[] {
  return sources.flatMap(source => source.files);
}

/** One access module may be active; missing candidates stay inactive. */
export async function resolveAccessPlan(root: string, sources: readonly AccessContribution[]): Promise<AccessPlan | undefined> {
  const found: AccessPlan[] = [];
  for (const source of sources) {
    for (const file of source.files) {
      let info;
      try { info = await lstat(projectPath(root, file)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      if (!info.isFile() || info.isSymbolicLink()) throw new CormiError('CLIENT_MODULE_INVALID', 'Access module must be an ordinary source file.', { file });
      found.push({ owner: source.id, module: moduleRef({ specifier: './' + file, exportName: 'default' }) });
      break;
    }
  }
  if (found.length > 1) throw new CormiError('ACCESS_CONFLICT', 'Only one access module may be active.', { files: found.map(item => item.module.specifier) });
  return found[0] ? Object.freeze(found[0]) : undefined;
}
/** Opt-in native plugin: registers the access key and provider; requires initialStatePlugin. */
export const accessPlugin: Plugin.Object<AccessPluginOptions> = {
  name: 'cormi:access', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'files'].includes(key))) {
      throw new CormiError('ACCESS_INVALID', 'Invalid access plugin options.');
    }
    const id = options.id ?? 'cormi:access';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('ACCESS_INVALID', 'Invalid access id.');
    const contribution = accessContributions([{ id, files: options.files ?? DEFAULT_ACCESS_FILES }])[0]!;
    const config: AppConfigContribution = { id, keys: ['access', 'accessForbidden'] };
    const runtime: RuntimeContribution = { id, module: { specifier: '@cormijs/runtime', exportName: 'accessRuntime' } };
    ctx.effect(() => ctx.react.appConfig.tap({ id: id + ':config', owner: id, ownerOrder: 0, run: () => [config] }));
    // Access reads the initial-state context, so its provider must be inside initialStateRuntime.
    ctx.effect(() => ctx.react.runtime.tap({ id: id + ':runtime', owner: id, ownerOrder: 0, stage: 10, run: () => [runtime] }));
    ctx.effect(() => ctx.react.access.tap({ id: id + ':access', owner: id, ownerOrder: 0, run: () => [contribution] }));
  },
};
