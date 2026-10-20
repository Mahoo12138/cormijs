import { CormiError, type Plugin } from '@cormijs/core';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type {} from '@cormijs/plugin-vite';

export interface AliasPluginOptions {
  readonly id?: string;
  readonly aliases: Readonly<Record<string, string>>;
}
export interface ViteAlias { readonly find: string; readonly replacement: string }

export function resolveAliases(root: string, input: unknown): readonly ViteAlias[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CormiError('ALIAS_INVALID', 'aliases must be an object.');
  const entries = Object.entries(input as Record<string, unknown>);
  if (!entries.length || entries.length > 64) throw new CormiError('ALIAS_INVALID', 'aliases must contain 1 to 64 entries.');
  return Object.freeze(entries.map(([find, replacement]) => {
    if (!find || find.length > 128 || /[\0\r\n\\]/.test(find) || isAbsolute(find)) throw new CormiError('ALIAS_INVALID', 'Invalid alias name.', { find });
    if (typeof replacement !== 'string' || !replacement || replacement.length > 1024 || isAbsolute(replacement) || /[\0\r\n\\]/.test(replacement)) {
      throw new CormiError('ALIAS_INVALID', 'Alias replacement must be a project-relative path.', { find });
    }
    const target = resolve(root, replacement), local = relative(root, target);
    if (!local || local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) throw new CormiError('ALIAS_INVALID', 'Alias replacement escapes the project.', { find });
    return Object.freeze({ find, replacement: target });
  }));
}

function existingAliases(value: unknown): ViteAlias[] {
  if (Array.isArray(value)) return value.filter((item): item is ViteAlias => !!item && typeof item === 'object' && typeof (item as ViteAlias).find === 'string'
    && typeof (item as ViteAlias).replacement === 'string');
  if (value && typeof value === 'object') return Object.entries(value as Record<string, unknown>)
    .filter(([, replacement]) => typeof replacement === 'string').map(([find, replacement]) => ({ find, replacement: replacement as string }));
  return [];
}

/** Opt-in project-local aliases merged into Vite's resolver; TypeScript paths remain explicit. */
export const aliasPlugin: Plugin.Object<AliasPluginOptions> = {
  name: 'cormi:alias', inject: ['vite', 'projectRoot'],
  apply(ctx, options) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'aliases'].includes(key))) {
      throw new CormiError('ALIAS_INVALID', 'Invalid alias plugin options.');
    }
    const id = options.id ?? 'cormi:alias';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('ALIAS_INVALID', 'Invalid alias plugin id.');
    if (options.aliases === undefined) throw new CormiError('ALIAS_INVALID', 'aliases is required.');
    const aliases = resolveAliases(ctx.projectRoot.root, options.aliases);
    ctx.effect(() => ctx.vite.add('cormi:alias', () => ({
      name: 'cormi:alias', enforce: 'pre',
      config(config) {
        return { resolve: { alias: [...existingAliases(config.resolve?.alias), ...aliases] } };
      },
    })));
  },
};
