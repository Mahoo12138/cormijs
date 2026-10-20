import { CormiError, type Plugin } from '@cormijs/core';
import { expandRouteConfig, type ConfigRoute } from '@cormijs/routes';
import type {} from './index.js';

export interface RouteConfigOptions {
  readonly id: string;
  readonly stage?: number;
  readonly routes: readonly ConfigRoute[];
}
/** Declarative nested routes contributed through the native React route hook. */
export const routeConfigPlugin: Plugin.Object<RouteConfigOptions> = {
  name: 'cormi:route-config', inject: ['react'],
  apply(ctx, options) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'stage', 'routes'].includes(key))
      || typeof options.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(options.id)
      || !Number.isFinite(options.stage ?? 0) || !Array.isArray(options.routes)) {
      throw new CormiError('ROUTE_CONFIG_INVALID', 'Invalid route config options.');
    }
    const id = options.id, stage = options.stage ?? 0;
    const routes = expandRouteConfig(options.routes, { pluginId: id });
    if (!routes.length) return;
    ctx.effect(() => ctx.react.routes.tap({ id: id + ':routes', owner: id, ownerOrder: 0, stage, run: current => [...current, ...routes] }));
  },
};
