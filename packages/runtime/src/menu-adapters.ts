import type { ReactNode } from 'react';
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
  /** Resolved from `meta.icon` (or the route id) through the caller's icon registry. */
  readonly icon?: ReactNode;
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
export function toLayoutRoutes(items: readonly MenuItem[], icons?: Readonly<Record<string, ReactNode>>): readonly LayoutRoute[] {
  const iconOf = (item: MenuItem): ReactNode => {
    if (!icons) return undefined;
    const key = typeof item.meta.icon === 'string' && item.meta.icon ? item.meta.icon : item.id;
    return Object.prototype.hasOwnProperty.call(icons, key) ? icons[key] : undefined;
  };
  return Object.freeze(items.map(item => {
    const icon = iconOf(item);
    return Object.freeze({
      path: item.path, name: item.title,
      ...(icon !== undefined ? { icon } : {}),
      ...(item.children.length ? { routes: toLayoutRoutes(item.children, icons) } : {}),
    });
  }));
}
