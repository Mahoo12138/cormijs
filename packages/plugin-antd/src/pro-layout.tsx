import { ProLayout, SettingDrawer, type MenuDataItem } from '@ant-design/pro-layout';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { toLayoutRoutes, useMenu, useMenuCollapse } from '@cormijs/runtime';

export interface ProLayoutSettings {
  readonly layout?: 'side' | 'top' | 'mix';
  readonly navTheme?: 'light' | 'realDark';
  readonly colorPrimary?: string;
  readonly fixedHeader?: boolean;
  readonly fixSiderbar?: boolean;
  readonly siderWidth?: number;
  readonly contentWidth?: 'Fluid' | 'Fixed';
}
export interface ProLayoutSettingsState {
  readonly settings: Readonly<ProLayoutSettings>;
  update(patch: Partial<ProLayoutSettings>): void;
  reset(): void;
}
export interface ProLayoutShellProps {
  readonly title?: string;
  readonly logo?: ReactNode | string;
  readonly layout?: 'side' | 'top' | 'mix';
  readonly fixedHeader?: boolean;
  readonly siderWidth?: number;
  /** Disabled by default: antd Sider otherwise forces expansion at desktop widths and drops the persisted state. */
  readonly breakpoint?: false | 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'xxl';
  /** Icons keyed by `meta.icon`, falling back to the route id. */
  readonly icons?: Readonly<Record<string, ReactNode>>;
  /** Initial ProLayout settings; later prop changes are ignored. */
  readonly settings?: ProLayoutSettings;
  /** Render ProLayout's setting drawer (theme/layout editor). */
  readonly settingDrawer?: boolean;
  /** Persist settings under this localStorage key; omit to keep settings in memory. */
  readonly settingsStorageKey?: string;
  readonly children?: ReactNode;
}

const settingKeys = ['layout', 'navTheme', 'colorPrimary', 'fixedHeader', 'fixSiderbar', 'siderWidth', 'contentWidth'] as const;
function settingsFrom(value: unknown, strict: boolean): ProLayoutSettings {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (strict) throw new TypeError('PRO_LAYOUT_SETTINGS_INVALID: settings must be an object');
    return Object.freeze({});
  }
  const input = value as Record<string, unknown>, result: Record<string, unknown> = {};
  for (const key of settingKeys) {
    if (!(key in input) || input[key] === undefined) continue;
    const item = input[key];
    const valid = key === 'layout' ? item === 'side' || item === 'top' || item === 'mix'
      : key === 'navTheme' ? item === 'light' || item === 'realDark'
        : key === 'colorPrimary' ? typeof item === 'string' && item.length > 0 && item.length <= 64 && !/[\0\r\n]/.test(item)
          : key === 'fixedHeader' || key === 'fixSiderbar' ? typeof item === 'boolean'
            : key === 'siderWidth' ? typeof item === 'number' && Number.isFinite(item) && item >= 0 && item <= 1000
              : item === 'Fluid' || item === 'Fixed';
    if (!valid) {
      if (strict) throw new TypeError(`PRO_LAYOUT_SETTINGS_INVALID: invalid ${key}`);
      continue;
    }
    result[key] = item;
  }
  return Object.freeze(result as ProLayoutSettings);
}
const ProLayoutSettingsContext = createContext<ProLayoutSettingsState | null>(null);
/** Settings editor state shared with the layout children; requires ProLayoutShell. */
export function useProLayoutSettings(): ProLayoutSettingsState {
  const value = useContext(ProLayoutSettingsContext);
  if (!value) throw new Error('PRO_LAYOUT_SETTINGS_MISSING: render inside ProLayoutShell');
  return value;
}

/**
 * ProLayout chrome for the application's global layout (`src/layouts/index.*`).
 * Mount menuPlugin and antdPlugin first; this component owns no plugin resources.
 */
export function ProLayoutShell({ title, logo, layout = 'side', fixedHeader = true, siderWidth = 208, breakpoint = false,
  icons, settings: initialSettings, settingDrawer = false, settingsStorageKey, children }: ProLayoutShellProps) {
  if (settingsStorageKey !== undefined && (typeof settingsStorageKey !== 'string' || !settingsStorageKey || settingsStorageKey.length > 128 || /[\0\r\n]/.test(settingsStorageKey))) {
    throw new TypeError('PRO_LAYOUT_SETTINGS_INVALID: settingsStorageKey must be bounded text');
  }
  if (typeof settingDrawer !== 'boolean') throw new TypeError('PRO_LAYOUT_SETTINGS_INVALID: settingDrawer must be boolean');
  const menu = useMenu();
  const { pathname } = useLocation();
  const { collapsed, setCollapsed } = useMenuCollapse();
  const defaults = useRef<Readonly<ProLayoutSettings>>(Object.freeze({
    layout, navTheme: 'light', fixedHeader, fixSiderbar: true, siderWidth, contentWidth: 'Fluid',
  }));
  const [settings, setSettings] = useState<Readonly<ProLayoutSettings>>(() => Object.freeze({ ...defaults.current, ...settingsFrom(initialSettings, false) }));
  const settingsRef = useRef(settings); settingsRef.current = settings;
  const settingsReady = useRef(false), settingDrawerReady = useRef(false);
  const persist = useCallback((value: Readonly<ProLayoutSettings>) => {
    if (!settingsStorageKey) return;
    try { window.localStorage.setItem(settingsStorageKey, JSON.stringify(value)); } catch { /* persistence is best effort */ }
  }, [settingsStorageKey]);
  const apply = useCallback((value: unknown) => {
    if (!settingsReady.current) return;
    const clean = settingsFrom(value, false);
    if (!Object.keys(clean).length) return;
    const next = Object.freeze({ ...settingsRef.current, ...clean });
    settingsRef.current = next; setSettings(next); persist(next);
  }, [persist]);
  const update = useCallback((patch: Partial<ProLayoutSettings>) => apply(settingsFrom(patch, true)), [apply]);
  const reset = useCallback(() => {
    settingsReady.current = true;
    const next = defaults.current;
    settingsRef.current = next; setSettings(next);
    if (settingsStorageKey) try { window.localStorage.removeItem(settingsStorageKey); } catch { /* best effort */ }
  }, [settingsStorageKey]);
  useEffect(() => {
    try {
      if (settingsStorageKey) {
        const raw = window.localStorage.getItem(settingsStorageKey);
        if (raw && raw.length <= 65536) {
          const stored = settingsFrom(JSON.parse(raw), false);
          if (Object.keys(stored).length) {
            const next = Object.freeze({ ...defaults.current, ...stored });
            settingsRef.current = next; setSettings(next);
          }
        }
      }
    } catch { /* corrupt storage is ignored */ }
    finally { settingsReady.current = true; }
  }, [settingsStorageKey]);
  const state = useMemo<ProLayoutSettingsState>(() => Object.freeze({ settings, update, reset }), [settings, update, reset]);
  const route = useMemo(() => ({ path: '/', routes: toLayoutRoutes(menu, icons) as unknown as MenuDataItem[] }), [menu, icons]);
  return (
    <ProLayoutSettingsContext.Provider value={state}>
      <ProLayout
        title={title}
        logo={logo}
        layout={settings.layout ?? 'side'}
        navTheme={settings.navTheme ?? 'light'}
        theme={settings.navTheme === 'realDark' ? 'dark' : 'light'}
        colorPrimary={settings.colorPrimary}
        fixedHeader={settings.fixedHeader ?? true}
        fixSiderbar={settings.fixSiderbar ?? true}
        siderWidth={settings.siderWidth ?? 208}
        contentWidth={settings.contentWidth}
        breakpoint={breakpoint}
        location={{ pathname }}
        route={route}
        collapsed={collapsed}
        onCollapse={value => setCollapsed(value)}
        menuItemRender={(item, dom) => item.path ? <Link to={item.path}>{dom}</Link> : dom}
      >
        {children}
      </ProLayout>
      {settingDrawer ? <SettingDrawer settings={settings as never} onSettingChange={next => {
        if (!settingDrawerReady.current) { settingDrawerReady.current = true; return; }
        apply(next);
      }} disableUrlParams /> : null}
    </ProLayoutSettingsContext.Provider>
  );
}
