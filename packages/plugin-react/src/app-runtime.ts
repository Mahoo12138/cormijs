import { CormiError, type Plugin } from '@cormijs/core';
import { moduleRef, projectPath, type ModuleRef } from '@cormijs/routes';
import { lstat } from 'node:fs/promises';
import { clientModuleFile } from './modules.js';
import type {} from './index.js';

/** A native contribution owns optional module discovery and/or runtime configuration keys. */
export interface AppConfigContribution {
  readonly id: string;
  readonly module?: ModuleRef;
  readonly candidates?: readonly string[];
  readonly keys?: readonly string[];
}
export interface AppRuntimePlan { readonly module?: ModuleRef; readonly keys: readonly string[]; readonly owner?: string }
export const APP_RUNTIME_KEYS = Object.freeze(['setup', 'render', 'patchClientRoutes', 'rootContainer', 'onRouteChange'] as const);
export function appConfigContributions(input: unknown): readonly AppConfigContribution[] {
  if (!Array.isArray(input) || input.length > 128) throw new CormiError('APP_RUNTIME_INVALID', 'Expected at most 128 app runtime contributions.');
  const ids = new Set<string>(), keys = new Set<string>(APP_RUNTIME_KEYS);
  return Object.freeze(input.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new CormiError('APP_RUNTIME_INVALID', 'Invalid app runtime contribution.');
    const row = item as Record<string, unknown>;
    if (Object.keys(row).some(key => !['id','module','candidates','keys'].includes(key)) || typeof row.id !== 'string' || !row.id || row.id.length > 128 || ids.has(row.id)) throw new CormiError('APP_RUNTIME_INVALID', 'Invalid or duplicate contribution id.');
    ids.add(row.id);
    if (row.module !== undefined && row.candidates !== undefined) throw new CormiError('APP_RUNTIME_INVALID', 'A source must choose a module or candidates, not both.');
    const candidates = row.candidates, extra = row.keys ?? [];
    if (candidates !== undefined && (!Array.isArray(candidates) || !candidates.length || candidates.length > 16 || candidates.some(file => typeof file !== 'string' || !/\.[jt]sx?$/.test(file) || file.startsWith('.') || file.includes('\\') || file.split('/').some((part: string) => !part || part === '..' || part.startsWith('.'))))) throw new CormiError('APP_RUNTIME_INVALID', 'Expected project-relative app source candidates.');
    if (!Array.isArray(extra) || extra.length > 128) throw new CormiError('APP_RUNTIME_INVALID', 'Invalid runtime keys.');
    for (const key of extra) {
      if (typeof key !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || ['default','constructor','prototype','__proto__'].includes(key) || keys.has(key)) throw new CormiError('APP_RUNTIME_KEY_CONFLICT', 'Invalid or duplicate app runtime key.', { key });
      keys.add(key);
    }
    return Object.freeze({ id: row.id, ...(row.module === undefined ? {} : { module: moduleRef(row.module) }),
      ...(candidates === undefined ? {} : { candidates: Object.freeze([...(candidates as string[])]) }), keys: Object.freeze([...extra] as string[]) });
  }));
}
export function appRuntimeFiles(root: string, sources: readonly AppConfigContribution[]): string[] {
  return sources.flatMap(source => [...(source.candidates ?? []), ...(source.module ? [clientModuleFile(root, source.module)].filter((file): file is string => !!file) : [])]);
}
export async function resolveAppRuntime(root: string, sources: readonly AppConfigContribution[]): Promise<AppRuntimePlan> {
  const modules: Array<{ module: ModuleRef; owner: string }> = [];
  for (const source of sources) {
    if (source.module) modules.push({ module: source.module, owner: source.id });
    for (const file of source.candidates ?? []) {
      try {
        const info = await lstat(projectPath(root, file));
        if (!info.isFile() || info.isSymbolicLink()) throw new CormiError('CLIENT_MODULE_INVALID', 'App configuration must be an ordinary source file.', { file });
        modules.push({ module: moduleRef({ specifier: './' + file, exportName: '*' }), owner: source.id });
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    }
  }
  if (modules.length > 1) throw new CormiError('APP_RUNTIME_CONFLICT', 'Only one application runtime module may be selected.', { modules: modules.map(item => item.module.specifier) });
  return Object.freeze({ ...modules[0], keys: Object.freeze(sources.flatMap(source => source.keys ?? [])) });
}
export interface AppRuntimeOptions { readonly files?: readonly string[] }
/** Opt-in convention: existing src/app.tsx React components are not silently reinterpreted. */
export const appRuntimePlugin: Plugin.Object<AppRuntimeOptions> = {
  name: 'cormi:app-runtime', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Object.keys(options).some(key => key !== 'files')) throw new CormiError('APP_RUNTIME_INVALID', 'Invalid app runtime options.');
    const contribution = appConfigContributions([{ id: 'cormi:app-runtime', candidates: options.files ?? ['src/app.ts','src/app.tsx','src/app.js','src/app.jsx'] }]);
    ctx.effect(() => ctx.react.appConfig.tap({ id: 'cormi:app-runtime', owner: 'cormi:app-runtime', ownerOrder: 0, run: () => contribution }));
  },
};
