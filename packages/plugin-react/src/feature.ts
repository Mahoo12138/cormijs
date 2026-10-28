import { CormiError, type Plugin, type RuntimePluginDescriptor } from '@cormijs/core';
import { moduleRef, routeMeta, type ModuleRef, type RouteRecord } from '@cormijs/routes';
import type {} from './index.js';

export interface ReactFeature {
  readonly id: string;
  readonly stage?: number;
  readonly routes?: readonly (Omit<RouteRecord, 'source'> & { readonly source?: RouteRecord['source'] })[];
  readonly runtime?: readonly RuntimePluginDescriptor[];
  /** Locale catalog directory to scan, relative to project root */
  readonly localeDirectory?: string;
  /** Extra model files to include, relative to project root */
  readonly models?: readonly string[];
  /** Access function module reference (note: multiple access sources may conflict) */
  readonly access?: ModuleRef;
  /** Global style files to include, relative to project root */
  readonly styles?: readonly string[];
  /** Human-readable description of what this feature provides (for DevTools/docs) */
  readonly description?: string;
  /** Schemastery schema for the app.* config keys this feature contributes (for documentation and runtime validation) */
  readonly configSchema?: unknown;
}

/** Convenience for declarative features. Native Cordis still owns activation, injection and disposal. */
export function defineReactFeature(definition: ReactFeature): Plugin.Object<void> {
  const allowedKeys = ['id', 'stage', 'routes', 'runtime', 'localeDirectory', 'models', 'access', 'styles', 'description', 'configSchema'];
  if (!definition || typeof definition !== 'object' || typeof definition.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(definition.id)
    || Object.keys(definition).some(key => !allowedKeys.includes(key))
    || !Number.isFinite(definition.stage ?? 0) || !Array.isArray(definition.routes ?? []) || (definition.routes?.length ?? 0) > 10000) {
    throw new CormiError('FEATURE_INVALID', 'Invalid declarative React feature.');
  }

  // Validate new fields
  if (definition.localeDirectory !== undefined && (typeof definition.localeDirectory !== 'string' || !definition.localeDirectory)) {
    throw new CormiError('FEATURE_INVALID', 'localeDirectory must be a non-empty string.');
  }
  if (definition.models !== undefined && (!Array.isArray(definition.models) || definition.models.some(m => typeof m !== 'string'))) {
    throw new CormiError('FEATURE_INVALID', 'models must be an array of strings.');
  }
  if (definition.styles !== undefined && (!Array.isArray(definition.styles) || definition.styles.some(s => typeof s !== 'string'))) {
    throw new CormiError('FEATURE_INVALID', 'styles must be an array of strings.');
  }

  const id = definition.id, stage = definition.stage ?? 0;
  // Validate the complete route graph only after all features have contributed (parents may be external).
  const routes: readonly RouteRecord[] = Object.freeze((definition.routes ?? []).map(route => Object.freeze({
    ...route, ...(route.module ? { module: moduleRef(route.module) } : {}),
    ...(route.errorBoundary !== undefined ? { errorBoundary: moduleRef(route.errorBoundary) } : {}),
    ...(route.meta !== undefined ? { meta: routeMeta(route.meta) } : {}),
    source: Object.freeze({ ...route.source, pluginId: id }),
  })));
  // Store as RuntimePluginDescriptor[]; runtimeContributions() normalises them to ModuleRef when generating.
  const runtime: readonly RuntimePluginDescriptor[] = Object.freeze([...(definition.runtime ?? [])]);

  return {
    name: id, inject: ['react'],
    apply: ctx => {
      if (routes.length) {
        ctx.effect(() => ctx.react.routes.tap({ id: id + ':routes', owner: id, ownerOrder: 0, stage,
          run: current => [...current, ...routes] }));
      }
      if (runtime.length) {
        ctx.effect(() => ctx.react.runtime.tap({ id: id + ':runtime', owner: id, ownerOrder: 0, stage,
          run: () => runtime }));
      }
      // Locale directory contribution
      if (definition.localeDirectory) {
        ctx.effect(() => ctx.react.locale.tap({ id: id + ':locale', owner: id, ownerOrder: 0, stage,
          run: () => [{ id: id + ':locale-catalog', directory: definition.localeDirectory }] }));
      }
      // Model files contribution
      if (definition.models && definition.models.length > 0) {
        ctx.effect(() => ctx.react.models.tap({ id: id + ':models', owner: id, ownerOrder: 0, stage,
          run: () => [{ id: id + ':model-files', files: definition.models }] }));
      }
      // Global styles contribution
      if (definition.styles && definition.styles.length > 0) {
        ctx.effect(() => ctx.react.styles.tap({ id: id + ':styles', owner: id, ownerOrder: 0, stage,
          run: () => [{ id: id + ':styles', files: definition.styles! }] }));
      }
      // TODO: Access contribution - currently access only supports single source, multiple sources would conflict.
      // When access plugin supports composition, add:
      // if (definition.access) { ctx.react.access.tap(...) }
    },
  };
}
