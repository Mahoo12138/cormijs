import { CormiError, type Plugin } from '@cormijs/core';
import { isAbsolute, relative, resolve, sep } from 'node:path';

export interface PluginEntry<T = any> {
  readonly id: string;
  readonly plugin: Plugin<T>;
  readonly options?: T;
  readonly enabled?: boolean;
}
export interface Preset {
  readonly id: string;
  readonly presets?: readonly Preset[];
  readonly plugins?: readonly PluginEntry[];
  readonly defaults?: Readonly<Record<string, unknown>>;
}
export interface CormiConfig {
  readonly presets?: readonly Preset[];
  readonly plugins?: readonly PluginEntry[];
  /** Application-specific data is interpreted by the command provider, not the launcher. */
  readonly app?: Readonly<Record<string, unknown>>;
  readonly watch?: readonly string[];
}
export interface ConfigEnvironment { readonly root: string; readonly command: string; readonly mode: string }
export type ConfigExport = CormiConfig | ((environment: ConfigEnvironment) => CormiConfig | Promise<CormiConfig>);
export function defineConfig<T extends ConfigExport>(config: T): T { return config; }
export function definePreset<T extends Preset>(preset: T): T { return preset; }

function invalid(path: string, message: string): never {
  throw new CormiError('CONFIG_INVALID', `${path}: ${message}`, { path });
}
function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) invalid(path, 'expected a plain object');
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: string[], path: string): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalid(`${path}.${key}`, 'unknown field');
}
function array(value: unknown, path: string): readonly unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) invalid(path, 'expected an array');
  return value;
}
function id(value: unknown, path: string): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,127}$/.test(value)) invalid(path, 'invalid stable id');
  return value;
}
function cloneData(value: unknown, path: string, seen = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object') invalid(path, 'expected finite JSON data');
  if (seen.has(value)) invalid(path, 'cyclic application data');
  seen.add(value);
  try {
    if (Array.isArray(value)) return Object.freeze(value.map((v, i) => cloneData(v, `${path}[${i}]`, seen)));
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, child] of Object.entries(object(value, path))) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) invalid(`${path}.${key}`, 'reserved key');
      if (child !== undefined) result[key] = cloneData(child, `${path}.${key}`, seen);
    }
    return Object.freeze(result);
  } finally { seen.delete(value); }
}
function merge(a: Readonly<Record<string, unknown>>, b: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result = { ...a };
  for (const [key, value] of Object.entries(b)) {
    const previous = result[key];
    result[key] = value && previous && typeof value === 'object' && typeof previous === 'object'
      && !Array.isArray(value) && !Array.isArray(previous)
      ? merge(previous as Record<string, unknown>, value as Record<string, unknown>) : value;
  }
  return result;
}
export function projectFile(root: string, file: string): string {
  const absolute = resolve(root, file);
  const path = relative(root, absolute);
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) invalid('watch', 'file must be inside project root');
  return absolute;
}
export function normalizeConfig(input: unknown, root: string): {
  plugins: readonly PluginEntry[]; app: Readonly<Record<string, unknown>>; watch: readonly string[];
} {
  const config = object(input, 'config');
  keys(config, ['plugins', 'presets', 'app', 'watch'], 'config');
  const plugins: PluginEntry[] = []; const ids = new Set<string>(); const presetIds = new Set<string>();
  const stack = new Set<object>(); let defaults: Record<string, unknown> = {};
  function add(entries: unknown, path: string): void {
    for (const [i, value] of array(entries, path).entries()) {
      const at = `${path}[${i}]`; const entry = object(value, at);
      keys(entry, ['id', 'plugin', 'options', 'enabled'], at);
      const name = id(entry.id, `${at}.id`);
      if (ids.has(name) || name === 'cormi:commands') invalid(`${at}.id`, `duplicate or reserved id ${name}`);
      ids.add(name);
      if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') invalid(`${at}.enabled`, 'expected boolean');
      if (typeof entry.plugin !== 'function' && !(entry.plugin && typeof entry.plugin === 'object' && typeof (entry.plugin as any).apply === 'function')) invalid(`${at}.plugin`, 'expected native Cordis plugin');
      if (entry.enabled !== false) plugins.push(Object.freeze({ id: name, plugin: entry.plugin as Plugin, options: entry.options }));
    }
  }
  function visit(value: unknown, depth: number): void {
    const preset = object(value, 'preset');
    if (depth > 32 || stack.has(preset)) invalid('presets', 'cycle or nesting limit');
    keys(preset, ['id', 'presets', 'plugins', 'defaults'], 'preset');
    const name = id(preset.id, 'preset.id');
    if (presetIds.has(name)) invalid('preset.id', `duplicate preset ${name}`);
    presetIds.add(name); stack.add(preset);
    for (const child of array(preset.presets, 'preset.presets')) visit(child, depth + 1);
    if (preset.defaults !== undefined) defaults = merge(defaults, cloneData(object(preset.defaults, 'preset.defaults'), 'preset.defaults') as Record<string, unknown>);
    add(preset.plugins, `preset(${name}).plugins`); stack.delete(preset);
  }
  for (const preset of array(config.presets, 'presets')) visit(preset, 0);
  add(config.plugins, 'plugins');
  const app = cloneData(merge(defaults, config.app === undefined ? {} : cloneData(object(config.app, 'app'), 'app') as Record<string, unknown>), 'app') as Readonly<Record<string, unknown>>;
  const watch = array(config.watch, 'watch').map(value => {
    if (typeof value !== 'string' || !value || isAbsolute(value)) invalid('watch', 'expected a project-relative filename');
    return projectFile(root, value);
  });
  if (watch.length > 256) invalid('watch', 'too many files');
  return { plugins: Object.freeze(plugins), app, watch: Object.freeze(watch) };
}
