import { CormiError, type Plugin } from '@cormijs/core';
import { transform } from 'esbuild';
import type {} from '@cormijs/plugin-vite';

export interface DefinePluginOptions {
  readonly id?: string;
  readonly values: Readonly<Record<string, unknown>>;
}
export interface DefineEntry { readonly key: string; readonly code: string }

const keyPattern = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;
const blockedKeys = new Set(['process', 'process.env', 'process.env.NODE_ENV', 'import.meta', 'import.meta.env']);
const blockedRoots = new Set(['this', 'super', 'import', 'globalThis', 'window', 'document', 'require', 'module', 'exports']);
const loaders: Record<string, 'js' | 'jsx' | 'ts' | 'tsx'> = { '.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'jsx', '.ts': 'ts', '.tsx': 'tsx' };

/** Values become JSON literals, so a string stays a quoted string rather than a raw expression. */
export function resolveDefines(input: unknown): readonly DefineEntry[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CormiError('DEFINE_INVALID', 'values must be an object.');
  const entries = Object.entries(input as Record<string, unknown>);
  if (!entries.length || entries.length > 64) throw new CormiError('DEFINE_INVALID', 'values must contain 1 to 64 entries.');
  const defined = entries.map(([key, value]) => {
    const root = key.split('.')[0] ?? key;
    if (!key || key.length > 256 || !keyPattern.test(key) || blockedKeys.has(key) || blockedRoots.has(root) || key.startsWith('import.meta.')) {
      throw new CormiError('DEFINE_INVALID', 'Invalid define key.', { key });
    }
    let code: string | undefined;
    try { code = JSON.stringify(value); } catch { throw new CormiError('DEFINE_INVALID', 'Define value must be JSON-serializable.', { key }); }
    if (code === undefined || code.length > 4096) throw new CormiError('DEFINE_INVALID', 'Define value must be a bounded JSON literal.', { key });
    return Object.freeze({ key, code });
  });
  // esbuild rejects a define that is a dotted prefix of another, and Vite would replace the longer key after the shorter one already won.
  for (const { key } of defined) {
    if (defined.some(other => other.key !== key && other.key.startsWith(key + '.'))) {
      throw new CormiError('DEFINE_INVALID', 'Define keys may not nest.', { key });
    }
  }
  return Object.freeze(defined.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)));
}

/** Vite applies `define` during builds only, so dev modules are replaced here with the same literals. */
export async function applyDefines(defines: Readonly<Record<string, string>>, code: string, id: string):
  Promise<{ code: string; map: string } | undefined> {
  const clean = id.split('?')[0] ?? id;
  const dot = clean.lastIndexOf('.');
  const loader = dot < 0 ? undefined : loaders[clean.slice(dot).toLowerCase()];
  if (!loader || !Object.keys(defines).some(key => code.includes(key))) return undefined;
  const result = await transform(code, {
    loader, define: defines, jsx: 'preserve', target: 'esnext', charset: 'utf8', sourcemap: true, sourcefile: clean, logLevel: 'silent',
  });
  return { code: result.code, map: result.map };
}

/** Configured defines win over values supplied by Vite itself or other plugins. */
export function mergeDefines(configured: unknown, entries: readonly DefineEntry[]): Record<string, string> {
  const merged: Record<string, string> = {};
  if (configured && typeof configured === 'object' && !Array.isArray(configured)) {
    for (const [key, value] of Object.entries(configured as Record<string, unknown>)) if (typeof value === 'string') merged[key] = value;
  }
  for (const { key, code } of entries) merged[key] = code;
  return merged;
}

/** Compile-time constants for dev, build and preview; TypeScript still needs an ambient declaration per key. */
export const definePlugin: Plugin.Object<DefinePluginOptions> = {
  name: 'cormi:define', inject: ['vite'],
  apply(ctx, options) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'values'].includes(key))) {
      throw new CormiError('DEFINE_INVALID', 'Invalid define plugin options.');
    }
    const id = options.id ?? 'cormi:define';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('DEFINE_INVALID', 'Invalid define plugin id.');
    if (options.values === undefined) throw new CormiError('DEFINE_INVALID', 'values is required.');
    const entries = resolveDefines(options.values);
    const defines = Object.freeze(Object.fromEntries(entries.map(({ key, code }) => [key, code])));
    ctx.effect(() => ctx.vite.add(id, () => {
      // One flag per Vite session: dev replaces here, builds let Vite's own define plugin handle the same literals.
      let serving = false;
      return {
        name: id, enforce: 'pre',
        config(config, env) {
          serving = env.command === 'serve';
          return { define: mergeDefines(config.define, entries) };
        },
        async transform(code: string, moduleId: string) {
          if (!serving) return null;
          const result = await applyDefines(defines, code, moduleId);
          return result ? { code: result.code, map: JSON.parse(result.map) } : null;
        },
      };
    }));
  },
};
