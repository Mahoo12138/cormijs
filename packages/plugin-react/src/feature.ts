import { CormiError, type Plugin, type RuntimePluginDescriptor } from '@cormijs/core';
import { moduleRef, routeMeta, type RouteRecord } from '@cormijs/routes';
import type {} from './index.js';

export interface ReactFeature {
  readonly id: string;
  readonly stage?: number;
  readonly routes?: readonly (Omit<RouteRecord, 'source'> & { readonly source?: RouteRecord['source'] })[];
  readonly runtime?: readonly RuntimePluginDescriptor[];
}
/** Convenience for declarative features. Native Cordis still owns activation, injection and disposal. */
export function defineReactFeature(definition: ReactFeature): Plugin.Object<void> {
  if (!definition || typeof definition !== 'object' || typeof definition.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]*$/.test(definition.id)
    || Object.keys(definition).some(key => !['id', 'stage', 'routes', 'runtime'].includes(key))
    || !Number.isFinite(definition.stage ?? 0) || !Array.isArray(definition.routes ?? []) || (definition.routes?.length ?? 0) > 10000) {
    throw new CormiError('FEATURE_INVALID', 'Invalid declarative React feature.');
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
      if (routes.length) ctx.effect(() => ctx.react.routes.tap({ id: id + ':routes', owner: id, ownerOrder: 0, stage,
        run: current => [...current, ...routes] }));
      if (runtime.length) ctx.effect(() => ctx.react.runtime.tap({ id: id + ':runtime', owner: id, ownerOrder: 0, stage,
        run: () => runtime }));
    },
  };
}
