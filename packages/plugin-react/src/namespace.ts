import { CormiError } from '@cormijs/core';

export interface FeatureNamespace {
  readonly id: string;
  /** Stable public contribution ID, not a URL, a service scope, or a lifecycle registration. */
  key(local: string): string;
}
/** Preserve explicit author and instance identity. Never truncate, sanitize, or use a Fiber UID. */
export function createFeatureNamespace(pluginId: string, instance: string): FeatureNamespace {
  if (typeof pluginId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,105}$/.test(pluginId) || pluginId === 'cormi' || pluginId.startsWith('cormi:')
    || typeof instance !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,47}$/.test(instance)) {
    throw new CormiError('FEATURE_NAMESPACE_INVALID', 'Expected a public plugin identity and a lowercase instance key.');
  }
  const id = pluginId + ':' + instance;
  if (id.length > 120) throw new CormiError('FEATURE_NAMESPACE_INVALID', 'Feature namespace exceeds the public identity budget.');
  return Object.freeze({ id, key(local: string) {
    if (typeof local !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/.test(local) || id.length + 1 + local.length > 128) {
      throw new CormiError('FEATURE_NAMESPACE_INVALID', 'Contribution identity must be a single segment of at most 128 characters including namespace.');
    }
    return id + ':' + local;
  } });
}
