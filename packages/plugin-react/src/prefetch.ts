import { CormiError, type Plugin } from '@cormijs/core';
import type { RuntimeContribution } from './generate.js';
import type {} from './index.js';

export interface RoutePrefetchOptions {
  readonly id?: string;
  /** `idle` warms every route after first paint; `manual` only exposes `usePrefetch()`. */
  readonly mode?: 'manual' | 'idle';
}
/** Opt-in plugin: exposes the generated route-module registry through `usePrefetch`. */
export const routePrefetchPlugin: Plugin.Object<RoutePrefetchOptions> = {
  name: 'cormi:route-prefetch', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'mode'].includes(key))) {
      throw new CormiError('PREFETCH_INVALID', 'Invalid route prefetch plugin options.');
    }
    const id = options.id ?? 'cormi:route-prefetch';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('PREFETCH_INVALID', 'Invalid route prefetch id.');
    const mode = options.mode ?? 'manual';
    if (mode !== 'manual' && mode !== 'idle') throw new CormiError('PREFETCH_INVALID', 'mode must be manual or idle.');
    const runtime: RuntimeContribution = { id, module: { specifier: '@cormijs/runtime', exportName: 'prefetchRuntime' }, options: { mode } };
    ctx.effect(() => ctx.react.runtime.tap({ id: id + ':runtime', owner: id, ownerOrder: 0, stage: 40, run: () => [runtime] }));
  },
};
