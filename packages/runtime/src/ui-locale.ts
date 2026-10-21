import { useMemo } from 'react';
import { useLocaleOptional } from './locale.js';

/**
 * Normalize a locale tag to `language[-Script][-REGION][-variant]` form. Accepts underscore
 * separators, `.UTF-8` suffixes and case differences; returns undefined for malformed tags.
 */
export function normalizeLocaleTag(input: string): string | undefined {
  if (typeof input !== 'string') return undefined;
  const value = input.trim().replace(/_/g, '-').replace(/\.(?:utf-?8|utf8)$/i, '').replace(/@.*$/, '');
  if (!value || value.length > 64) return undefined;
  const parts = value.split('-');
  if (parts.some(part => !part || part.length > 8 || !/^[A-Za-z0-9]+$/.test(part))) return undefined;
  return parts.map((part, index) => {
    if (index === 0) return part.toLowerCase();
    if (/^[A-Za-z]{4}$/.test(part)) return part[0]!.toUpperCase() + part.slice(1).toLowerCase();
    if (/^(?:[A-Za-z]{2}|[0-9]{3})$/.test(part)) return part.toUpperCase();
    return part.toLowerCase();
  }).join('-');
}

/** Full tag, then language-script (when present), then language. */
export function localeCandidates(locale: string): readonly string[] {
  const normalized = normalizeLocaleTag(locale);
  if (!normalized) return Object.freeze([]);
  const parts = normalized.split('-'), list: string[] = [normalized];
  if (parts.length > 2 && /^[A-Z][a-z]{3}$/.test(parts[1]!)) list.push(`${parts[0]}-${parts[1]}`);
  if (parts.length > 1) list.push(parts[0]!);
  return Object.freeze([...new Set(list)]);
}

/** dayjs locale module names are lowercase language[-region] candidates, e.g. `zh-CN` → `zh-cn`. */
export function dayjsLocaleCandidates(locale: string): readonly string[] {
  return Object.freeze(localeCandidates(locale).map(candidate => candidate.toLowerCase()));
}

export interface LocaleResourceMatch<T> {
  /** Normalized resource key that matched. */
  readonly locale: string;
  readonly value: T;
}

/** Resolve an app-supplied resource map (Antd locale objects, message bundles, loaders) by locale chain. */
export function resolveLocaleResource<T>(locale: string, resources: Readonly<Record<string, T>>): LocaleResourceMatch<T> | undefined {
  if (!resources || typeof resources !== 'object' || Array.isArray(resources)) throw new TypeError('LOCALE_RESOURCE_INVALID: resources must be an object');
  const normalized = new Map<string, T>();
  for (const [key, value] of Object.entries(resources)) {
    const tag = normalizeLocaleTag(key);
    if (tag && !normalized.has(tag)) normalized.set(tag, value);
  }
  for (const candidate of localeCandidates(locale)) {
    if (normalized.has(candidate)) return Object.freeze({ locale: candidate, value: normalized.get(candidate)! });
  }
  return undefined;
}

export interface UiLocaleResource<T> {
  readonly locale: string;
  readonly key?: string;
  readonly resource?: T;
}

/** Re-render the caller when the active locale changes and resolve the official UI resources. */
export function useLocaleResource<T>(resources: Readonly<Record<string, T>>, fallback = 'en'): UiLocaleResource<T> {
  const intl = useLocaleOptional();
  const locale = intl?.locale ?? fallback;
  return useMemo(() => {
    const match = resolveLocaleResource(locale, resources);
    return Object.freeze({ locale, ...(match ? { key: match.locale, resource: match.value } : {}) });
  }, [locale, resources]);
}
