import { Service, type Context } from 'cordis';
import { OrderedHooks } from '@cormijs/plugin-web';
import type { RuntimePluginDescriptor } from '@cormijs/core';

/**
 * RuntimeCompilationService: owns the runtime plugin contribution surface.
 *
 * Plugins that provide browser-side runtime plugins (Providers, app-level setup)
 * inject this service to contribute RuntimePluginDescriptors. This separates
 * runtime plugin management from other compilation concerns.
 *
 * The service is registered as 'runtime-compiler' on the context. For backward
 * compatibility, ctx.react.runtime continues to work as an alias pointing to
 * this service's plugins hook.
 *
 * @example
 * ```ts
 * export const myRuntimePlugin: Plugin = {
 *   name: 'my-runtime',
 *   inject: ['runtime-compiler'],
 *   apply(ctx) {
 *     ctx['runtime-compiler'].plugins.tap({
 *       id: 'my-runtime:plugin',
 *       owner: 'my-runtime',
 *       run: () => [{
 *         id: 'my-runtime:provider',
 *         module: { package: '@my/runtime', export: 'MyProvider' },
 *         options: { enabled: true }
 *       }]
 *     });
 *   }
 * };
 * ```
 */
export class RuntimeCompilationService extends Service {
  static inject = [] as const;

  /**
   * Ordered hooks for runtime plugin descriptors. These are serialized into
   * the generated application and loaded in the browser at boot time.
   */
  readonly plugins = new OrderedHooks<void, readonly RuntimePluginDescriptor[]>('runtime');

  constructor(ctx: Context) {
    super(ctx, 'runtime-compiler');
  }
}

declare module 'cordis' {
  interface Context {
    'runtime-compiler': RuntimeCompilationService;
  }
}
