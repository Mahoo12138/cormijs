import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { LocaleConfig, RuntimeConfig } from './app-config.js';

export interface IntlApi {
  readonly locale: string;
  setLocale(locale: string): void;
  t(key: string, values?: Readonly<Record<string, string | number>>): string;
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
    return text.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (match, name: string) => Object.hasOwn(values, name) ? String(values[name]) : match);
  }, [config, locale]);
  const value = useMemo<IntlApi>(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
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
