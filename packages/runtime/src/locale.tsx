import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { LocaleConfig, RuntimeConfig } from './app-config.js';
import { formatIcu } from './icu.js';

export interface IntlApi {
  readonly locale: string;
  setLocale(locale: string): void;
  t(key: string, values?: Readonly<Record<string, string | number>>): string;
  /** Catalog lookup without the key-as-text fallback. */
  peek(key: string): string | undefined;
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  formatDate(value: Date | number | string, options?: Intl.DateTimeFormatOptions): string;
  /** Locale-aware relative time, e.g. `-2` + `day` → "2 days ago". */
  formatRelativeTime(value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions): string;
  /** Plural-aware lookup: `${key}_${category}` → `${key}_other` → the plain key, with `{count}` interpolation. */
  tp(key: string, count: number, values?: Readonly<Record<string, string | number>>): string;
}

/** Pure plural selection shared by the provider and tests; `locales` is ordered (current, then fallback). */
export function selectPluralKey(messages: Readonly<Record<string, Readonly<Record<string, string>>>>, locales: readonly string[], key: string, category: string): string | undefined {
  for (const locale of locales) {
    const table = messages[locale];
    if (!table) continue;
    const text = table[`${key}_${category}`] ?? table[`${key}_other`] ?? table[key];
    if (text !== undefined) return text;
  }
  return undefined;
}

export function formatNumberFor(locale: string, value: number, options?: Intl.NumberFormatOptions): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('LOCALE_INVALID: formatNumber expects a finite number');
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatDateFor(locale: string, value: Date | number | string, options?: Intl.DateTimeFormatOptions): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError('LOCALE_INVALID: formatDate expects a valid date');
  return new Intl.DateTimeFormat(locale, options).format(date);
}

const relativeUnits = new Set<string>(['year', 'years', 'quarter', 'quarters', 'month', 'months', 'week', 'weeks', 'day', 'days', 'hour', 'hours', 'minute', 'minutes', 'second', 'seconds']);
export function formatRelativeTimeFor(locale: string, value: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('LOCALE_INVALID: formatRelativeTime expects a finite number');
  if (typeof unit !== 'string' || !relativeUnits.has(unit)) throw new TypeError('LOCALE_INVALID: formatRelativeTime expects a supported unit');
  return new Intl.RelativeTimeFormat(locale, options).format(value, unit);
}
const LocaleContext = createContext<IntlApi | null>(null);
const DEFAULT_STORAGE_KEY = 'cormi:locale';

function normalize(input: LocaleConfig = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('LOCALE_INVALID: locale config must be an object');
  for (const key of ['default', 'fallback', 'storageKey'] as const) {
    if (input[key] !== undefined && (typeof input[key] !== 'string' || !input[key])) throw new TypeError(`LOCALE_INVALID: ${key} must be a non-empty string`);
  }
  const messages = input.messages ?? {};
  if (!messages || typeof messages !== 'object' || Array.isArray(messages)) throw new TypeError('LOCALE_INVALID: messages must be an object');
  for (const [locale, table] of Object.entries(messages)) {
    if (!locale || !table || typeof table !== 'object' || Array.isArray(table)
      || Object.entries(table).some(([key, value]) => !key || typeof value !== 'string')) throw new TypeError('LOCALE_INVALID: message tables must contain string values');
  }
  const fallback = input.fallback ?? input.default;
  if (fallback !== undefined && Object.keys(messages).length && !Object.hasOwn(messages, fallback)) throw new TypeError('LOCALE_INVALID: fallback locale has no message table');
  return { default: input.default ?? fallback ?? 'en', fallback, messages, storageKey: input.storageKey ?? DEFAULT_STORAGE_KEY };
}
const readStored = (key: string) => {
  try { return typeof window === 'undefined' ? undefined : window.localStorage.getItem(key) ?? undefined; } catch { return undefined; }
};
const store = (key: string, locale: string) => {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(key, locale); } catch { /* persistence is best-effort */ }
};

/** Catalog files merged at build time fill the message tables; the app configuration module wins per key. */
export function applyLocaleCatalogs(config: Readonly<RuntimeConfig>, catalogs: readonly { locale: string; messages: Record<string, string> }[]): Readonly<RuntimeConfig> {
  if (!catalogs.length) return config;
  const locale = (config.locale ?? {}) as LocaleConfig;
  const merged: Record<string, Record<string, string>> = {};
  for (const catalog of catalogs) merged[catalog.locale] = { ...catalog.messages };
  for (const [code, table] of Object.entries(locale.messages ?? {})) merged[code] = { ...(merged[code] ?? {}), ...(table as Record<string, string>) };
  return Object.freeze({ ...config, locale: Object.freeze({ ...locale, messages: Object.freeze(merged) }) });
}

export function LocaleProvider({ appConfig, children }: { readonly appConfig: Readonly<RuntimeConfig>; readonly children?: ReactNode }) {
  const config = useMemo(() => normalize(appConfig.locale), [appConfig.locale]);
  const [locale, setLocaleState] = useState(() => {
    const stored = readStored(config.storageKey);
    if (stored && (!Object.keys(config.messages).length || Object.hasOwn(config.messages, stored))) return stored;
    return config.default;
  });
  const setLocale = useCallback((next: string) => {
    if (typeof next !== 'string' || !next) throw new TypeError('LOCALE_INVALID: locale must be a non-empty string');
    if (Object.keys(config.messages).length && !Object.hasOwn(config.messages, next)) throw new Error(`LOCALE_UNKNOWN: ${next}`);
    setLocaleState(next); store(config.storageKey, next);
  }, [config]);
  const t = useCallback((key: string, values?: Readonly<Record<string, string | number>>) => {
    if (typeof key !== 'string' || !key) return '';
    const text = config.messages[locale]?.[key] ?? (config.fallback ? config.messages[config.fallback]?.[key] : undefined) ?? key;
    if (!values) return text;
    return formatIcu(text, values, locale);
  }, [config, locale]);
  const peek = useCallback((key: string) => {
    if (typeof key !== 'string' || !key) return undefined;
    return config.messages[locale]?.[key] ?? (config.fallback ? config.messages[config.fallback]?.[key] : undefined);
  }, [config, locale]);
  const formatNumber = useCallback((input: number, options?: Intl.NumberFormatOptions) => formatNumberFor(locale, input, options), [locale]);
  const formatDate = useCallback((input: Date | number | string, options?: Intl.DateTimeFormatOptions) => formatDateFor(locale, input, options), [locale]);
  const formatRelativeTime = useCallback((input: number, unit: Intl.RelativeTimeFormatUnit, options?: Intl.RelativeTimeFormatOptions) => formatRelativeTimeFor(locale, input, unit, options), [locale]);
  const tp = useCallback((key: string, count: number, values?: Readonly<Record<string, string | number>>) => {
    if (typeof key !== 'string' || !key) return '';
    if (typeof count !== 'number' || !Number.isFinite(count)) throw new TypeError('LOCALE_INVALID: tp expects a finite count');
    const category = new Intl.PluralRules(locale).select(count);
    const text = selectPluralKey(config.messages, config.fallback ? [locale, config.fallback] : [locale], key, category)
      ?? config.messages[locale]?.[key] ?? (config.fallback ? config.messages[config.fallback]?.[key] : undefined) ?? key;
    return formatIcu(text, { count, ...(values ?? {}) }, locale);
  }, [config, locale]);
  const value = useMemo<IntlApi>(() => ({ locale, setLocale, t, peek, formatNumber, formatDate, formatRelativeTime, tp }), [locale, setLocale, t, peek, formatNumber, formatDate, formatRelativeTime, tp]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Reader for features such as menus that localize titles only when a locale provider exists. */
export function useLocaleOptional(): IntlApi | null {
  return useContext(LocaleContext);
}

export function useIntl(): IntlApi {
  const value = useContext(LocaleContext);
  if (!value) throw new Error('LOCALE_MISSING: enable localePlugin to use useIntl');
  return value;
}

export function FormattedMessage({ id, values, defaultMessage }: {
  readonly id: string; readonly values?: Readonly<Record<string, string | number>>; readonly defaultMessage?: string;
}) {
  const { t } = useIntl(), text = t(id, values);
  return <>{text === id && defaultMessage !== undefined ? defaultMessage : text}</>;
}

/** Runtime plugin object consumed by the generated entry when localePlugin is mounted. */
export const localeRuntime = { Provider: LocaleProvider };
