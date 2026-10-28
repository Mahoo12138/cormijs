import { Service, type Context } from 'cordis';
import { OrderedHooks } from '@cormijs/plugin-web';
import type { RouteRecord } from '@cormijs/routes';

/**
 * RouteCompilationService: owns the route contribution surface.
 *
 * Plugins that provide routes (either from convention, configuration, or
 * programmatic sources) inject this service to contribute RouteRecords.
 * This separates route discovery and transformation from other compilation concerns.
 *
 * The service is registered as 'route-compiler' on the context. For backward
 * compatibility, ctx.react.routes continues to work as an alias pointing to
 * this service's routes hook.
 *
 * The routes hook is unique: it's a reducing hook that transforms the route tree
 * through multiple stages (convention → config overlay → feature contributions →
 * layout wrapper → final validation).
 *
 * @example
 * ```ts
 * export const myRoutePlugin: Plugin = {
 *   name: 'my-routes',
 *   inject: ['route-compiler'],
 *   apply(ctx) {
 *     ctx['route-compiler'].routes.tap({
 *       id: 'my-routes:contrib',
 *       owner: 'my-routes',
 *       run: (current) => [...current, { id: 'my-page', path: '/my', module: './pages/my' }]
 *     });
 *   }
 * };
 * ```
 */
export class RouteCompilationService extends Service {
  static inject = [] as const;

  /**
   * Ordered reducing hooks for route tree transformations. Each hook receives
   * the current route tree and returns a modified version. The final result is
   * validated and used for code generation.
   */
  readonly routes = new OrderedHooks<readonly RouteRecord[], readonly RouteRecord[]>('routes');

  constructor(ctx: Context) {
    super(ctx, 'route-compiler');
  }
}

declare module 'cordis' {
  interface Context {
    'route-compiler': RouteCompilationService;
  }
}
