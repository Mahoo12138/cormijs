import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { matchPath, useLocation, type RouteObject } from 'react-router';
import { useAccessOptional } from './access.js';
import { useLocaleOptional } from './locale.js';
import { useRouteMatches } from './route-matches.js';

export interface MenuItem {
  readonly key: string;
  readonly id: string;
  readonly path: string;
  readonly title: string;
  /** `meta.locale` message key, kept for shells that render their own translated labels. */
  readonly locale?: string;
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
export interface MenuCollapseState {
  readonly collapsed: boolean;
  setCollapsed(value: boolean): void;
  toggle(): void;
}
const MenuStateContext = createContext<MenuCollapseState | null>(null);
const DEFAULT_COLLAPSE_KEY = 'cormi:menu:collapsed';

/** A `meta.locale` catalog entry wins over `meta.title`/`meta.name`; missing keys fall back instead of showing the raw key. */
function resolveTitle(meta: Readonly<Record<string, unknown>>, translate: ((key: string) => string | undefined) | null): string | undefined {
  const key = typeof meta.locale === 'string' ? meta.locale : undefined;
  const localized = key && translate ? translate(key) : undefined;
  if (typeof localized === 'string' && localized !== key) return localized;
  return typeof meta.title === 'string' ? meta.title : typeof meta.name === 'string' ? meta.name : undefined;
}

const metadata = (route: RouteObject) => {
  const handle = route.handle as { cormi?: { meta?: Record<string, unknown>; access?: string } } | undefined;
  const value = handle?.cormi?.meta;
  return { meta: value && typeof value === 'object' && !Array.isArray(value) ? value : {}, access: handle?.cormi?.access };
};
const pathOf = (parent: string, path: string | undefined) => {
  if (path === undefined || path === '') return parent || '/';
  return ((parent === '/' ? '' : parent.replace(/\/+$/, '')) + '/' + path.replace(/^\/+/, '')).replace(/\/{2,}/g, '/') || '/';
};

function build(routes: readonly RouteObject[], parent: string, access: Readonly<Record<string, boolean>> | null, depth: number, count: { value: number }, translate: ((key: string) => string | undefined) | null): MenuItem[] {
  if (depth > 64 || count.value > 1000) throw new Error('MENU_INVALID: menu tree exceeds the supported limit');
  const items: MenuItem[] = [];
  for (const route of routes) {
    if (!route || typeof route.id !== 'string' || route.path === '*') continue;
    count.value++;
    const info = metadata(route), meta = info.meta;
    const title = resolveTitle(meta, translate);
    const hidden = meta.hideInMenu === true || meta.hidden === true || meta.menu === false;
    const rule = typeof meta.access === 'string' ? meta.access : info.access;
    if (hidden || (rule !== undefined && access !== null && access[rule] !== true)) continue;
    const path = route.index ? parent : pathOf(parent, route.path);
    const children = build(route.children ?? [], path, access, depth + 1, count, translate);
    if (!title) { items.push(...children); continue; }
    items.push(Object.freeze({ key: route.id, id: route.id, path, title,
      order: typeof meta.order === 'number' && Number.isFinite(meta.order) ? meta.order : 0,
      meta: Object.freeze({ ...meta }), ...(typeof meta.locale === 'string' ? { locale: meta.locale as string } : {}), children: Object.freeze(children) }));
  }
  return items.sort((a, b) => a.order - b.order || (a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
}

export interface MenuCollapseSettings {
  readonly storageKey?: string;
  readonly defaultCollapsed?: boolean;
}
export interface MenuProviderProps {
  readonly routes: readonly RouteObject[];
  readonly options?: { readonly collapse?: MenuCollapseSettings } | unknown;
  readonly children?: ReactNode;
}
export function MenuProvider({ routes, options, children }: MenuProviderProps) {
  const access = useAccessOptional(), intl = useLocaleOptional();
  const translate = useMemo(() => (intl ? (key: string) => intl.peek(key) : null), [intl]);
  const items = useMemo(() => Object.freeze(build(routes, '/', access, 0, { value: 0 }, translate)), [routes, access, translate]);
  const menu = (options as { collapse?: MenuCollapseSettings } | undefined)?.collapse;
  const storageKey = typeof menu?.storageKey === 'string' && menu.storageKey ? menu.storageKey : DEFAULT_COLLAPSE_KEY;
  const [collapsed, setCollapsedState] = useState(() => {
    try {
      const stored = typeof window === 'undefined' ? undefined : window.localStorage.getItem(storageKey);
      if (stored === 'true') return true;
      if (stored === 'false') return false;
    } catch { /* persistence is best-effort */ }
    return menu?.defaultCollapsed === true;
  });
  const setCollapsed = useCallback((value: boolean) => {
    if (typeof value !== 'boolean') throw new TypeError('MENU_INVALID: setCollapsed expects a boolean');
    setCollapsedState(value);
    try { if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, String(value)); } catch { /* best-effort */ }
  }, [storageKey]);
  const toggle = useCallback(() => setCollapsedState(current => {
    const next = !current;
    try { if (typeof window !== 'undefined') window.localStorage.setItem(storageKey, String(next)); } catch { /* best-effort */ }
    return next;
  }), [storageKey]);
  const state = useMemo<MenuCollapseState>(() => Object.freeze({ collapsed, setCollapsed, toggle }), [collapsed, setCollapsed, toggle]);
  return <MenuStateContext.Provider value={state}><MenuContext.Provider value={items}>{children}</MenuContext.Provider></MenuStateContext.Provider>;
}

/** Collapse state for application shell chrome; independent of the menu tree itself. */
export function useMenuCollapse(): MenuCollapseState {
  const value = useContext(MenuStateContext);
  if (!value) throw new Error('MENU_MISSING: enable menuPlugin to use useMenuCollapse');
  return value;
}
export function useMenu(): readonly MenuItem[] {
  const items = useContext(MenuContext);
  if (!items) throw new Error('MENU_MISSING: enable menuPlugin to use useMenu');
  return items;
}
export function useBreadcrumb(): readonly BreadcrumbItem[] {
  const intl = useLocaleOptional();
  const translate = intl ? (key: string) => intl.peek(key) : null;
  return useRouteMatches().flatMap(match => {
    const title = resolveTitle(match.meta, translate);
    return title === undefined ? [] : [Object.freeze({ id: match.id, pathname: match.pathname, title, meta: match.meta })];
  });
}
/** Keys of menu items whose path matches the current location, including active ancestors. */
export function useActiveMenuKeys(): readonly string[] {
  const items = useMenu(), { pathname } = useLocation(), active: string[] = [];
  const visit = (list: readonly MenuItem[]): boolean => {
    let any = false;
    for (const item of list) {
      const child = visit(item.children);
      const matches = item.path === '/' ? pathname === '/' : matchPath({ path: item.path, end: false }, pathname) !== null;
      if (child || matches) { active.push(item.key); any = true; }
    }
    return any;
  };
  visit(items);
  return active;
}

/** Runtime plugin object consumed by the generated entry when menuPlugin is mounted. */
export const menuRuntime = { Provider: MenuProvider };
