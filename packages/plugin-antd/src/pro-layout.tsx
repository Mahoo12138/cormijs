import { ProLayout, SettingDrawer, type MenuDataItem } from '@ant-design/pro-layout';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { localeCandidates, toLayoutRoutes, useLocaleOptional, useMenu, useMenuCollapse } from '@cormijs/runtime';

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
  /** Mirror the active cormi locale into ProLayout's g_locale bridge; default true. */
  readonly syncLocale?: boolean;
  /** Override ProLayout main copy; SettingDrawer still uses its five built-in locale bundles. */
  readonly formatMessage?: (message: { readonly id: string; readonly defaultMessage?: string }) => string;
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
type ProLayoutLocale = 'zh-CN' | 'zh-TW' | 'en-US' | 'it-IT' | 'ko-KR';
const proLayoutLocaleAliases: Readonly<Record<string, ProLayoutLocale>> = Object.freeze({
  zh: 'zh-CN', 'zh-CN': 'zh-CN', 'zh-Hans': 'zh-CN', 'zh-TW': 'zh-TW', 'zh-Hant': 'zh-TW',
  en: 'en-US', 'en-US': 'en-US', it: 'it-IT', 'it-IT': 'it-IT', ko: 'ko-KR', 'ko-KR': 'ko-KR',
});
function proLayoutLocaleOf(locale: string): ProLayoutLocale {
  for (const candidate of localeCandidates(locale)) { const match = proLayoutLocaleAliases[candidate]; if (match) return match; }
  return 'en-US';
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
  icons, settings: initialSettings, settingDrawer = false, settingsStorageKey, syncLocale = true, formatMessage, children }: ProLayoutShellProps) {
  if (settingsStorageKey !== undefined && (typeof settingsStorageKey !== 'string' || !settingsStorageKey || settingsStorageKey.length > 128 || /[\0\r\n]/.test(settingsStorageKey))) {
    throw new TypeError('PRO_LAYOUT_SETTINGS_INVALID: settingsStorageKey must be bounded text');
  }
  if (typeof settingDrawer !== 'boolean') throw new TypeError('PRO_LAYOUT_SETTINGS_INVALID: settingDrawer must be boolean');
  if (typeof syncLocale !== 'boolean') throw new TypeError('PRO_LAYOUT_SETTINGS_INVALID: syncLocale must be boolean');
  if (formatMessage !== undefined && typeof formatMessage !== 'function') throw new TypeError('PRO_LAYOUT_SETTINGS_INVALID: formatMessage must be a function');
  const menu = useMenu();
  const { pathname } = useLocation();
  const intl = useLocaleOptional();
  const proLayoutLocale = proLayoutLocaleOf(intl?.locale ?? 'en');
  const [, setLocaleTick] = useState(0);
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
    if (!syncLocale || typeof window === 'undefined') return;
    const host = window as typeof window & { g_locale?: string };
    const previous = host.g_locale;
    host.g_locale = proLayoutLocale;
    window.dispatchEvent(new Event('languagechange'));
    setLocaleTick(value => value + 1);
    return () => {
      if (host.g_locale !== proLayoutLocale) return;
      if (previous === undefined) delete host.g_locale; else host.g_locale = previous;
    };
  }, [proLayoutLocale, syncLocale]);
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
        locale={proLayoutLocale}
        formatMessage={formatMessage}
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
