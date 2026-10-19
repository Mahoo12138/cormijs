import { CormiError, snapshotConfig, mergeConfigData, configLayer, type ConfigData, type ConfigLayer, type ConfigurationContext, type Plugin } from '@cormijs/core';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type { WorkerProfileOptions } from './worker-profile.js';

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
  /** Explicit native worker infrastructure, initialized before application plugins. */
  readonly worker?: Plugin<WorkerProfileOptions>;
  readonly presets?: readonly Preset[];
  readonly plugins?: readonly PluginEntry[];
  /** Application-specific data is interpreted by the command provider, not the launcher. */
  readonly app?: Readonly<Record<string, unknown>>;
  readonly watch?: readonly string[];
}
export interface ConfigEnvironment {
  readonly root: string; readonly command: string; readonly mode: string;
  /** Immutable Node bootstrap values. Includes private values: never spread this into app/runtime options. */
  readonly env: Readonly<Record<string, string | undefined>>;
}
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
export function projectFile(root: string, file: string): string {
  const absolute = resolve(root, file);
  const path = relative(root, absolute);
  if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) invalid('watch', 'file must be inside project root');
  return absolute;
}
export function normalizeConfig(input: unknown, root: string): {
  worker?: Plugin<WorkerProfileOptions>; plugins: readonly PluginEntry[]; app: ConfigData; watch: readonly string[];
  layers: readonly ConfigLayer[]; pluginSources: ConfigurationContext['plugins'];
} {
  const config = object(input, 'config');
  keys(config, ['plugins', 'presets', 'app', 'watch', 'worker'], 'config');
  if (config.worker !== undefined && typeof config.worker !== 'function'
    && !(config.worker && typeof config.worker === 'object' && typeof (config.worker as {apply?:unknown}).apply === 'function')) invalid('worker', 'expected a native worker profile plugin');
  const plugins: PluginEntry[] = []; const ids = new Set<string>(); const presetIds = new Set<string>();
  const stack = new Set<object>(); let defaults: ConfigData = {};
  const layers: ConfigLayer[] = [], pluginSources: Array<ConfigurationContext['plugins'][number]> = [];
  function add(entries: unknown, path: string): void {
    for (const [i, value] of array(entries, path).entries()) {
      const at = `${path}[${i}]`; const entry = object(value, at);
      keys(entry, ['id', 'plugin', 'options', 'enabled'], at);
      const name = id(entry.id, `${at}.id`);
      if (ids.has(name) || ['cormi:commands', 'cormi:diagnostics', 'cormi:worker-profile', 'cormi:execution-consumer'].includes(name)) invalid(`${at}.id`, `duplicate or reserved id ${name}`);
      ids.add(name);
      if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') invalid(`${at}.enabled`, 'expected boolean');
      if (typeof entry.plugin !== 'function' && !(entry.plugin && typeof entry.plugin === 'object' && typeof (entry.plugin as any).apply === 'function')) invalid(`${at}.plugin`, 'expected native Cordis plugin');
      if (entry.enabled !== false) plugins.push(Object.freeze({ id: name, plugin: entry.plugin as Plugin, options: entry.options }));
      pluginSources.push(Object.freeze({ id: name, source: path, enabled: entry.enabled !== false }));
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
    if (preset.defaults !== undefined) {
      const patch = snapshotConfig(preset.defaults, `preset(${name}).defaults`), next = mergeConfigData(defaults, patch);
      layers.push(configLayer(defaults, next, { kind: 'preset', id: name }, patch)); defaults = next;
    }
    add(preset.plugins, `preset(${name}).plugins`); stack.delete(preset);
  }
  for (const preset of array(config.presets, 'presets')) visit(preset, 0);
  add(config.plugins, 'plugins');
  const patch = snapshotConfig(config.app === undefined ? {} : config.app, 'app'), app = snapshotConfig(mergeConfigData(defaults, patch));
  layers.push(configLayer(defaults, app, { kind: 'user', id: 'config.app' }, patch));
  const watch = array(config.watch, 'watch').map(value => {
    if (typeof value !== 'string' || !value || isAbsolute(value)) invalid('watch', 'expected a project-relative filename');
    return projectFile(root, value);
  });
  if (watch.length > 256) invalid('watch', 'too many files');
  return { worker: config.worker as Plugin<WorkerProfileOptions> | undefined, plugins: Object.freeze(plugins), app, watch: Object.freeze(watch), layers: Object.freeze(layers), pluginSources: Object.freeze(pluginSources) };
}
