import { CormiError, type Plugin } from '@cormijs/core';
import type { RuntimeContribution } from './generate.js';
import type {} from './index.js';

export interface MenuPluginOptions {
  readonly id?: string;
}
/** Opt-in native plugin: derives menu and breadcrumb data from the mounted route tree. */
export const menuPlugin: Plugin.Object<MenuPluginOptions> = {
  name: 'cormi:menu', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'id')) {
      throw new CormiError('MENU_INVALID', 'Invalid menu plugin options.');
    }
    const id = options.id ?? 'cormi:menu';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('MENU_INVALID', 'Invalid menu id.');
    const runtime: RuntimeContribution = { id, module: { specifier: '@cormijs/runtime', exportName: 'menuRuntime' } };
    // Menu filtering reads optional access context, so it must sit inside accessRuntime.
    ctx.effect(() => ctx.react.runtime.tap({ id: id + ':runtime', owner: id, ownerOrder: 0, stage: 20, run: () => [runtime] }));
  },
};
