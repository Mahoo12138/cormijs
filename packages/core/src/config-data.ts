import { CormiError } from './index.js';

export type ConfigData = Readonly<Record<string, unknown>>;
export interface ConfigSource { readonly kind: 'preset' | 'user' | 'derive' | 'input'; readonly id: string }
export interface ConfigChange { readonly path: string; readonly operation: 'set' | 'delete' }
export interface ConfigLayer { readonly source: ConfigSource; readonly changes: readonly ConfigChange[] }
/** Bootstrap metadata only. Values and content fingerprints are deliberately not part of this report. */
export interface EnvironmentSummary {
  readonly mode: string;
  readonly nodeEnv: 'development' | 'production';
  readonly files: readonly { readonly name: string; readonly present: boolean }[];
  readonly variables: readonly { readonly name: string; readonly public: boolean; readonly source: string; readonly history: readonly string[] }[];
}
export interface ConfigurationContext {
  readonly environment?: EnvironmentSummary;
  readonly command: string;
  readonly layers: readonly ConfigLayer[];
  readonly plugins: readonly { readonly id: string; readonly source: string; readonly enabled: boolean }[];
}
const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
/** Shared data protocol only: no defaults, schema, command policy or configuration evaluation. */
export function snapshotConfig(value: unknown, path = 'app'): ConfigData {
  let nodes = 0, bytes = 0;
  const active = new Set<object>();
  const fail = (at: string): never => { throw new CormiError('CONFIG_INVALID', `${at}: expected bounded plain JSON data without accessors or reserved keys`, { path: at }); };
  const charge = (text: string) => { bytes += Buffer.byteLength(text); if (bytes > 4 * 1024 * 1024) fail(path); };
  function copy(input: unknown, at: string, depth: number): unknown {
    if (++nodes > 100000 || depth > 64) return fail(at);
    if (input === null || typeof input === 'string' || typeof input === 'boolean' || typeof input === 'number' && Number.isFinite(input)) {
      charge(JSON.stringify(input)); return input;
    }
    if (!input || typeof input !== 'object' || active.has(input) || !Array.isArray(input) && !plain(input)) return fail(at);
    active.add(input);
    try {
      const keys = Reflect.ownKeys(input);
      if (keys.length > 100000) return fail(at);
      if (Array.isArray(input)) {
        if (keys.length !== input.length + 1) return fail(at);
        charge('[]' + ','.repeat(Math.max(0, input.length - 1)));
        const result: unknown[] = [];
        for (let i = 0; i < input.length; i++) {
          const property = Object.getOwnPropertyDescriptor(input, String(i));
          if (!property || !('value' in property)) return fail(`${at}[${i}]`);
          result.push(copy(property.value, `${at}[${i}]`, depth + 1));
        }
        return Object.freeze(result);
      }
      const result: Record<string, unknown> = Object.create(null); charge('{}');
      for (const key of keys) {
        if (typeof key !== 'string' || ['__proto__', 'constructor', 'prototype'].includes(key)) return fail(at);
        const property = Object.getOwnPropertyDescriptor(input, key)!;
        if (!property.enumerable || !('value' in property)) return fail(`${at}.${key}`);
        if (property.value === undefined) continue;
        charge(JSON.stringify(key) + ':,'); result[key] = copy(property.value, `${at}.${key}`, depth + 1);
      }
      return Object.freeze(result);
    } finally { active.delete(input); }
  }
  if (!plain(value)) return fail(path);
  return copy(value, path, 0) as ConfigData;
}
/** Call with validated snapshots. Objects merge; arrays/scalars replace, never merge by index. */
export function mergeConfigData(a: ConfigData, b: ConfigData): ConfigData {
  const result: Record<string, unknown> = Object.assign(Object.create(null), a);
  for (const [key, value] of Object.entries(b)) result[key] = plain(value) && plain(result[key])
    ? mergeConfigData(result[key] as ConfigData, value) : value;
  return Object.freeze(result);
}
/** JSON pointers keep dotted keys distinct. Arrays are atomic configuration values. */
export function configLeaves(value: ConfigData): ReadonlyMap<string, unknown> {
  const result = new Map<string, unknown>();
  function visit(item: unknown, path: string) {
    if (plain(item) && Object.keys(item).length) {
      for (const key of Object.keys(item).sort()) visit(item[key], path + '/' + key.replace(/~/g, '~0').replace(/\//g, '~1'));
    } else if (path) result.set(path, item);
  }
  visit(value, ''); return result;
}
export function configLayer(before: ConfigData, after: ConfigData, source: ConfigSource, explicit?: ConfigData): ConfigLayer {
  const a = configLeaves(before), b = configLeaves(after), supplied = explicit && configLeaves(explicit);
  const changes: ConfigChange[] = [];
  for (const path of [...new Set([...a.keys(), ...b.keys()])].sort()) {
    if (!b.has(path)) changes.push(Object.freeze({ path, operation: 'delete' }));
    else if (!a.has(path) || JSON.stringify(a.get(path)) !== JSON.stringify(b.get(path)) || supplied?.has(path)) changes.push(Object.freeze({ path, operation: 'set' }));
  }
  return Object.freeze({ source: Object.freeze({ ...source }), changes: Object.freeze(changes) });
}
