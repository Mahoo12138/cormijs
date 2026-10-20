import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { RouteObject } from 'react-router';
import { useAccessOptional } from './access.js';
import { useRouteMatches } from './route-matches.js';

export interface MenuItem {
  readonly key: string;
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly order: number;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly children: readonly MenuItem[];
}
export interface BreadcrumbItem {
  readonly id: string;
  readonly pathname: string;
  readonly title: string;
  readonly meta: Readonly<Record<string, unknown>>;
}
const MenuContext = createContext<readonly MenuItem[] | null>(null);

const metadata = (route: RouteObject) => {
  const handle = route.handle as { cormi?: { meta?: Record<string, unknown>; access?: string } } | undefined;
  const value = handle?.cormi?.meta;
  return { meta: value && typeof value === 'object' && !Array.isArray(value) ? value : {}, access: handle?.cormi?.access };
};
const pathOf = (parent: string, path: string | undefined) => {
  if (path === undefined || path === '') return parent || '/';
  return ((parent === '/' ? '' : parent.replace(/\/+$/, '')) + '/' + path.replace(/^\/+/, '')).replace(/\/{2,}/g, '/') || '/';
};

function build(routes: readonly RouteObject[], parent: string, access: Readonly<Record<string, boolean>> | null, depth: number, count: { value: number }): MenuItem[] {
  if (depth > 64 || count.value > 1000) throw new Error('MENU_INVALID: menu tree exceeds the supported limit');
  const items: MenuItem[] = [];
  for (const route of routes) {
    if (!route || typeof route.id !== 'string' || route.path === '*') continue;
    count.value++;
    const info = metadata(route), meta = info.meta;
    const title = typeof meta.title === 'string' ? meta.title : typeof meta.name === 'string' ? meta.name : undefined;
    const hidden = meta.hideInMenu === true || meta.hidden === true || meta.menu === false;
    const rule = typeof meta.access === 'string' ? meta.access : info.access;
    if (hidden || (rule !== undefined && access !== null && access[rule] !== true)) continue;
    const path = route.index ? parent : pathOf(parent, route.path);
    const children = build(route.children ?? [], path, access, depth + 1, count);
    if (!title) { items.push(...children); continue; }
    items.push(Object.freeze({ key: route.id, id: route.id, path, title,
      order: typeof meta.order === 'number' && Number.isFinite(meta.order) ? meta.order : 0,
      meta: Object.freeze({ ...meta }), children: Object.freeze(children) }));
  }
  return items.sort((a, b) => a.order - b.order || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
}

export function MenuProvider({ routes, children }: { readonly routes: readonly RouteObject[]; readonly children?: ReactNode }) {
  const access = useAccessOptional();
  const items = useMemo(() => Object.freeze(build(routes, '/', access, 0, { value: 0 })), [routes, access]);
  return <MenuContext.Provider value={items}>{children}</MenuContext.Provider>;
}
export function useMenu(): readonly MenuItem[] {
  const items = useContext(MenuContext);
  if (!items) throw new Error('MENU_MISSING: enable menuPlugin to use useMenu');
  return items;
}
export function useBreadcrumb(): readonly BreadcrumbItem[] {
  return useRouteMatches().flatMap(match => typeof match.meta.title === 'string'
    ? [Object.freeze({ id: match.id, pathname: match.pathname, title: match.meta.title, meta: match.meta })]
    : []);
}

/** Runtime plugin object consumed by the generated entry when menuPlugin is mounted. */
export const menuRuntime = { Provider: MenuProvider };
