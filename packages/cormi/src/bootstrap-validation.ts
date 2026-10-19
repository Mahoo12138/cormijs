import { CormiError, snapshotConfig } from '@cormijs/core';
import { isAbsolute } from 'node:path';
import { projectFile } from './config.js';
import { validateMode, type EnvironmentSnapshot } from './environment.js';
import type { LaunchPlan, LaunchRequest } from './bootstrap.js';

export function launchPlan(value: unknown, request: LaunchRequest): LaunchPlan {
  const data = snapshotConfig(value, 'bootstrap.plan');
  if (Object.keys(data).sort().join(',') !== 'configurationCommand,mode,nodeEnv,watch'
    || typeof data.configurationCommand !== 'string' || !/^[a-z][a-z0-9-]*$/.test(data.configurationCommand)
    || !['development','production'].includes(data.nodeEnv as string) || typeof data.watch !== 'boolean') {
    throw new CormiError('BOOTSTRAP_PLAN_INVALID', 'Bootstrap must return a complete launch plan.');
  }
  validateMode(data.mode);
  for (const key of ['mode','watch','configurationCommand'] as const) {
    if (request[key] !== undefined && request[key] !== data[key]) throw new CormiError('BOOTSTRAP_PLAN_INVALID', 'Bootstrap cannot silently override explicit carrier input: ' + key);
  }
  return data as unknown as LaunchPlan;
}
export function environmentPaths(root: string, value: readonly string[]): readonly string[] {
  if (!Array.isArray(value) || value.length > 16) throw new CormiError('ENV_PATHS_INVALID', 'Environment requires at most sixteen exact candidate paths.');
  const result = Array.from(value, file => {
    if (typeof file !== 'string' || file.length > 4096 || file.includes('\0') || !isAbsolute(file)) {
      throw new CormiError('ENV_PATHS_INVALID', 'Environment candidate paths must be absolute project files.');
    }
    return projectFile(root, file);
  });
  if (new Set(result).size !== result.length) throw new CormiError('ENV_PATHS_INVALID', 'Duplicate environment candidates.');
  return Object.freeze(result);
}
/** Copy across the provider boundary before any asynchronous compilation or IPC serialization. */
export function environmentSnapshot(value: unknown, mode: string, paths: readonly string[]): EnvironmentSnapshot {
  const data = snapshotConfig(value, 'bootstrap.environment');
  const fail = (): never => { throw new CormiError('ENV_SNAPSHOT_INVALID', 'Environment provider returned an invalid bounded snapshot.'); };
  if (Object.keys(data).sort().join(',') !== 'files,fingerprint,mode,origins,paths,values' || data.mode !== mode
    || !Array.isArray(data.paths) || JSON.stringify(data.paths) !== JSON.stringify(paths)
    || typeof data.fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(data.fingerprint)
    || !Array.isArray(data.files) || data.files.length !== paths.length
    || !data.values || typeof data.values !== 'object' || Array.isArray(data.values)
    || !data.origins || typeof data.origins !== 'object' || Array.isArray(data.origins)) return fail();
  const values = data.values as Record<string,unknown>, origins = data.origins as Record<string,unknown>;
  if (Object.keys(values).length > 512 || Buffer.byteLength(JSON.stringify(values)) > 1024 * 1024
    || Object.keys(origins).sort().join('\0') !== Object.keys(values).sort().join('\0')) return fail();
  for (const [name, value] of Object.entries(values)) {
    if (!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name) || ['NODE_OPTIONS','VITE_USER_NODE_ENV','CORMI_PUBLIC_'].includes(name)
      || typeof value !== 'string' || value.includes('\0')) return fail();
    const history = origins[name];
    if (!Array.isArray(history) || !history.length || history.length > 512
      || history.some(item => typeof item !== 'string' || !item.length || item.length > 256 || /[\x00-\x1f]/.test(item))) return fail();
  }
  for (const file of data.files) {
    if (!file || typeof file !== 'object' || Object.keys(file).sort().join(',') !== 'name,present'
      || typeof file.name !== 'string' || !file.name.length || file.name.length > 256 || /[\x00-\x1f]/.test(file.name) || typeof file.present !== 'boolean') return fail();
  }
  return data as unknown as EnvironmentSnapshot;
}
