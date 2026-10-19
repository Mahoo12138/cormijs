import { CormiError } from '@cormijs/core';
import type { ResolvedConfig } from 'vite';

/** A backend session captures only explicitly public strings, never the whole process environment. */
export function publicEnvironment(input?: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const source = input ?? Object.fromEntries(Object.entries(process.env).filter(([key, value]) => key.startsWith('CORMI_PUBLIC_') && value !== undefined));
  if (!source || typeof source !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(source))) throw new CormiError('ENV_PUBLIC_INVALID', 'Expected a public environment record.');
  const result: Record<string, string> = Object.create(null);
  const keys = Reflect.ownKeys(source);
  if (keys.length > 256) throw new CormiError('ENV_PUBLIC_LIMIT', 'Too many public environment variables.');
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(source, key)!;
    if (typeof key !== 'string' || !/^CORMI_PUBLIC_[A-Za-z0-9_]+$/.test(key) || key.length > 128
      || !field.enumerable || !('value' in field) || typeof field.value !== 'string') {
      throw new CormiError('ENV_PUBLIC_INVALID', 'Only own CORMI_PUBLIC_ string values may enter the client environment.');
    }
    result[key] = field.value;
  }
  if (Buffer.byteLength(JSON.stringify(result)) > 256 * 1024) throw new CormiError('ENV_PUBLIC_LIMIT', 'Public environment values exceed the budget.');
  return Object.freeze(result);
}
export function applyPublicEnvironment(config: ResolvedConfig, mode: string, values: Readonly<Record<string, string>>): void {
  const definitions = [config.define, ...Object.values(config.environments).map(environment => environment.define)];
  // Reject removed keys as well as changed values: production captures define before this hook,
  // so repairing only config.env would otherwise make dev succeed while build silently loses values.
  const required = [config.define, config.environments.client?.define];
  const missing = required.some(table => Object.entries(values).some(([key, value]) =>
    !Object.hasOwn(table ?? {}, 'import.meta.env.' + key) || table?.['import.meta.env.' + key] !== JSON.stringify(value)));
  if (missing || config.mode !== mode || config.envDir !== false || !Array.isArray(config.envPrefix) || config.envPrefix.length !== 0
    || definitions.some(table => Object.entries(table ?? {}).some(([key, value]) => key === 'import.meta.env' || key === 'process.env' || key === 'process.env.NODE_ENV'
      || key.startsWith('import.meta.env.') && (!Object.hasOwn(values, key.slice(16)) || value !== JSON.stringify(values[key.slice(16)]))))) {
    throw new CormiError('VITE_RESERVED_CONFIG', 'Native plugins cannot override mode, environment loading, public prefix or environment defines.');
  }
  // Production defines are captured before configResolved; InlineConfig owns their JSON literals.
  // This public env object serves dev/HTML readers. Do not reload files or expand values again.
  // Keep Vite's env object identity; its resolved property is readonly, while its public entries are configurable.
  for (const key of Object.keys(config.env)) delete config.env[key];
  Object.assign(config.env, values, { BASE_URL: config.base, MODE: mode, DEV: !config.isProduction, PROD: config.isProduction });
}
