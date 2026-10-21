import type { MenuItem } from './menu.js';

/** Structural Ant Design Menu item; the application still owns the antd dependency and rendering. */
export interface AntdMenuItem {
  /** Navigation path; suitable as Menu `key` for onClick navigation. */
  readonly key: string;
  readonly label: string;
  readonly routeId: string;
  readonly children?: readonly AntdMenuItem[];
}
/** Structural ProLayout route; `name` is already localized by the menu runtime. */
export interface LayoutRoute {
  readonly path: string;
  readonly name: string;
  readonly routes?: readonly LayoutRoute[];
}

/** Converts a menu tree to antd `items` without importing antd. */
export function toAntdMenuItems(items: readonly MenuItem[]): readonly AntdMenuItem[] {
  return Object.freeze(items.map(item => Object.freeze({
    key: item.path, label: item.title, routeId: item.id,
    ...(item.children.length ? { children: toAntdMenuItems(item.children) } : {}),
  })));
}

/** Converts a menu tree to ProLayout-style routes without importing ProLayout. */
export function toLayoutRoutes(items: readonly MenuItem[]): readonly LayoutRoute[] {
  return Object.freeze(items.map(item => Object.freeze({
    path: item.path, name: item.title,
    ...(item.children.length ? { routes: toLayoutRoutes(item.children) } : {}),
  })));
}
