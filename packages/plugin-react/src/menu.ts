import { CormiError, type Plugin, type RuntimePluginDescriptor } from '@cormijs/core';
import type {} from './index.js';

export interface MenuPluginOptions {
  readonly id?: string;
  /** Default collapse state and the localStorage key that remembers it. */
  readonly collapse?: { readonly storageKey?: string; readonly defaultCollapsed?: boolean };
}
/** Opt-in native plugin: derives menu and breadcrumb data from the mounted route tree. */
export const menuPlugin: Plugin.Object<MenuPluginOptions> = {
  name: 'cormi:menu', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'collapse'].includes(key))) {
      throw new CormiError('MENU_INVALID', 'Invalid menu plugin options.');
    }
    const collapse = options.collapse;
    if (collapse !== undefined) {
      if (!collapse || typeof collapse !== 'object' || Array.isArray(collapse)) throw new CormiError('MENU_INVALID', 'Menu collapse options must be an object.');
      if (Object.keys(collapse).some(key => !['storageKey', 'defaultCollapsed'].includes(key))) throw new CormiError('MENU_INVALID', 'Unknown menu collapse option.');
      if (collapse.storageKey !== undefined && (typeof collapse.storageKey !== 'string' || !collapse.storageKey || collapse.storageKey.length > 128 || /[\0\r\n]/.test(collapse.storageKey))) {
        throw new CormiError('MENU_INVALID', 'Menu storage key must be bounded text.');
      }
      if (collapse.defaultCollapsed !== undefined && typeof collapse.defaultCollapsed !== 'boolean') throw new CormiError('MENU_INVALID', 'defaultCollapsed must be a boolean.');
    }
    const id = options.id ?? 'cormi:menu';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('MENU_INVALID', 'Invalid menu id.');
    const runtime: RuntimePluginDescriptor = { id, module: { package: '@cormijs/runtime', export: 'menuRuntime' }, ...(collapse ? { options: { collapse } } : {}) };
    // Menu filtering reads optional access context, so it must sit inside accessRuntime.
    ctx.effect(() => ctx.react.runtime.tap({ id: id + ':runtime', owner: id, ownerOrder: 0, stage: 20, run: () => [runtime] }));
  },
};
