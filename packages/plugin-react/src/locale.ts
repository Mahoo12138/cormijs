import { CormiError, type Plugin } from '@cormijs/core';
import { readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { projectPath } from '@cormijs/routes';
import type { AppConfigContribution } from './app-runtime.js';
import type { RuntimeContribution } from './generate.js';
import type {} from './index.js';

export interface LocaleCatalogSource {
  readonly id: string;
  readonly directory?: string;
}
export function localeCatalogSources(input: unknown): readonly LocaleCatalogSource[] {
  if (!Array.isArray(input) || input.length > 8) throw new CormiError('LOCALE_INVALID', 'Expected at most 8 locale catalog sources.');
  const ids = new Set<string>();
  return Object.freeze(input.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CormiError('LOCALE_INVALID', 'Expected a locale catalog source.');
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some(key => !['id', 'directory'].includes(key)) || typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(item.id) || ids.has(item.id)) {
      throw new CormiError('LOCALE_INVALID', 'Invalid or duplicate locale catalog source.');
    }
    if (item.directory !== undefined && !catalogPath(item.directory)) throw new CormiError('LOCALE_INVALID', 'Locale directory must be a project-relative path.');
    ids.add(item.id);
    return Object.freeze({ id: item.id, ...(item.directory !== undefined ? { directory: item.directory as string } : {}) });
  }));
}
export interface LocaleCatalog {
  readonly locale: string;
  readonly messages: Readonly<Record<string, string>>;
}
export interface LocalePluginOptions {
  readonly id?: string;
  /** Project-relative directory of `<locale>.json` message catalogs; disabled when undefined. */
  readonly directory?: string;
}
const localePattern = /^[a-zA-Z]{2,3}(?:[-_][A-Za-z0-9]{2,4})*$/;
const catalogPath = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 512 && !isAbsolute(value) && !/[\0\r\n?#%\\]/.test(value)
  && value.split('/').every(part => part && part !== '.' && part !== '..' && !part.startsWith('.'));

function validateCatalog(locale: string, input: unknown): Readonly<Record<string, string>> {
  if (!localePattern.test(locale)) throw new CormiError('LOCALE_INVALID', 'Catalog file name must be a locale code.', { locale });
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CormiError('LOCALE_INVALID', 'Message catalog must be a JSON object.', { locale });
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 512) throw new CormiError('LOCALE_INVALID', 'Message catalog exceeds 512 keys.', { locale });
  const messages: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!key || key.length > 128 || typeof value !== 'string' || value.length > 2048) {
      throw new CormiError('LOCALE_INVALID', 'Message entries must map bounded keys to string values.', { locale, key });
    }
    messages[key] = value;
  }
  return Object.freeze(messages);
}

/** Merge catalogs in hook order; two sources may not publish the same locale. */
export function mergeLocaleCatalogs(catalogs: readonly LocaleCatalog[]): readonly LocaleCatalog[] {
  const byLocale = new Map<string, Record<string, string>>();
  for (const catalog of catalogs) {
    const current = byLocale.get(catalog.locale);
    if (!current) { byLocale.set(catalog.locale, { ...catalog.messages }); continue; }
    const clash = Object.keys(catalog.messages).filter(key => Object.hasOwn(current, key));
    if (clash.length) throw new CormiError('LOCALE_CONFLICT', 'Two locale catalog sources define the same key.', { locale: catalog.locale, keys: clash.slice(0, 4) });
    Object.assign(current, catalog.messages);
  }
  return Object.freeze([...byLocale.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([locale, messages]) => Object.freeze({ locale, messages: Object.freeze(messages) })));
}

/** Read every configured catalog directory; a missing directory is simply inactive. Same-locale catalogs merge, conflicting keys fail. */
export async function readLocaleCatalogs(root: string, sources: readonly LocaleCatalogSource[]): Promise<readonly LocaleCatalog[]> {
  const collected: LocaleCatalog[] = [];
  for (const source of sources) collected.push(...await readDirectoryCatalogs(root, source.directory));
  return mergeLocaleCatalogs(collected);
}

async function readDirectoryCatalogs(root: string, directory: string | undefined): Promise<readonly LocaleCatalog[]> {
  if (directory === undefined) return Object.freeze([]);
  if (!catalogPath(directory)) throw new CormiError('LOCALE_INVALID', 'Locale directory must be a project-relative path.');
  const base = projectPath(root, directory);
  let names: string[] = [];
  try {
    if (!(await stat(base)).isDirectory()) throw new CormiError('LOCALE_INVALID', 'Locale directory must be a directory.');
    names = (await readdir(base)).filter(name => name.endsWith('.json')).sort();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return Object.freeze([]);
    if (error instanceof CormiError) throw error;
    throw new CormiError('LOCALE_INVALID', 'Locale directory cannot be read.');
  }
  if (names.length > 32) throw new CormiError('LOCALE_INVALID', 'A locale directory holds at most 32 catalogs.');
  const catalogs: LocaleCatalog[] = [];
  for (const name of names) {
    const locale = name.slice(0, -'.json'.length);
    const text = await readFile(join(base, name), 'utf8');
    if (text.length > 65536) throw new CormiError('LOCALE_INVALID', 'Message catalog exceeds 64 KiB.', { locale });
    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch { throw new CormiError('LOCALE_INVALID', 'Message catalog is not valid JSON.', { locale }); }
    catalogs.push(Object.freeze({ locale, messages: validateCatalog(locale, parsed) }));
  }
  return Object.freeze(catalogs);
}
/** Opt-in native plugin: registers the locale config key and browser provider. */
export const localePlugin: Plugin.Object<LocalePluginOptions> = {
  name: 'cormi:locale', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'directory'].includes(key))) {
      throw new CormiError('LOCALE_INVALID', 'Invalid locale plugin options.');
    }
    if (options.directory !== undefined && !catalogPath(options.directory)) throw new CormiError('LOCALE_INVALID', 'Locale directory must be a project-relative path.');
    const id = options.id ?? 'cormi:locale';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('LOCALE_INVALID', 'Invalid locale id.');
    const config: AppConfigContribution = { id, keys: ['locale'] };
    const runtime: RuntimeContribution = { id, module: { specifier: '@cormijs/runtime', exportName: 'localeRuntime' } };
    ctx.effect(() => ctx.react.appConfig.tap({ id: id + ':config', owner: id, ownerOrder: 0, run: () => [config] }));
    ctx.effect(() => ctx.react.runtime.tap({ id: id + ':runtime', owner: id, ownerOrder: 0, run: () => [runtime] }));
    const source: LocaleCatalogSource = Object.freeze({ id, ...(options.directory !== undefined ? { directory: options.directory } : {}) });
    ctx.effect(() => ctx.react.locale.tap({ id: id + ':catalog', owner: id, ownerOrder: 0, run: () => [source] }));
  },
};
