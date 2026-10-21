import { matchRoutes, type RouteObject } from 'react-router';
import type { RouteChangeEvent } from './app-config.js';

export interface HeadMeta {
  readonly name?: string;
  readonly property?: string;
  readonly content: string;
}
export interface HeadLink {
  readonly rel: string;
  readonly href: string;
}
export type JsonLd = Readonly<Record<string, unknown>> | readonly Readonly<Record<string, unknown>>[];
export interface RouteHead {
  readonly title?: string;
  readonly metas?: readonly HeadMeta[];
  readonly links?: readonly HeadLink[];
  /** schema.org JSON-LD object or array of objects; the deepest declared block wins. */
  readonly jsonLd?: JsonLd;
}
export interface HeadOptions {
  /** Applied as `${title}${titleTemplate ?? ''}`; the deeper route's title wins. */
  readonly titleTemplate?: string;
  /** Restored when the owning application unmounts. */
  readonly baseTitle?: string;
}
/** Marks every node this runtime owns so repeated navigation can replace them without touching author tags. */
export const HEAD_ATTRIBUTE = 'data-cormi-head';

const text = (value: unknown, max: number) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\0\r\n]/.test(value);

/** Route meta is JSON; this validates the documented head shape and rejects anything else. */
export function normalizeHead(input: unknown): RouteHead {
  if (input === undefined) return Object.freeze({});
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('HEAD_INVALID: meta.head must be an object');
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !['title', 'metas', 'links', 'jsonLd'].includes(key))) throw new TypeError('HEAD_INVALID: unknown meta.head field');
  if (value.title !== undefined && !text(value.title, 512)) throw new TypeError('HEAD_INVALID: title must be bounded text');
  const normalizeList = <T>(entries: unknown, limit: number, map: (row: Record<string, unknown>, index: number) => T, fields: readonly string[]): readonly T[] => {
    if (!Array.isArray(entries) || entries.length > limit) throw new TypeError('HEAD_INVALID: expected a bounded array');
    return Object.freeze(entries.map((entry, index) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError('HEAD_INVALID: expected an object entry');
      const row = entry as Record<string, unknown>;
      if (Object.keys(row).some(key => !fields.includes(key))) throw new TypeError('HEAD_INVALID: unknown entry field');
      return map(row, index);
    }));
  };
  const metas = value.metas === undefined ? undefined : normalizeList(value.metas, 32, row => {
    const selectors = ['name', 'property'].filter(key => row[key] !== undefined);
    if (selectors.length !== 1 || !text(row[selectors[0]!], 256) || !text(row.content, 4096)) throw new TypeError('HEAD_INVALID: meta entries need one selector and content');
    return Object.freeze({ [selectors[0]!]: row[selectors[0]!] as string, content: row.content as string }) as HeadMeta;
  }, ['name', 'property', 'content']);
  const links = value.links === undefined ? undefined : normalizeList(value.links, 32, row => {
    if (!text(row.rel, 128) || !text(row.href, 2048)) throw new TypeError('HEAD_INVALID: link entries need rel and href');
    return Object.freeze({ rel: row.rel as string, href: row.href as string });
  }, ['rel', 'href']);
  const jsonLd = value.jsonLd === undefined ? undefined : normalizeJsonLd(value.jsonLd);
  return Object.freeze({
    ...(value.title !== undefined ? { title: value.title as string } : {}),
    ...(metas !== undefined ? { metas } : {}),
    ...(links !== undefined ? { links } : {}),
    ...(jsonLd !== undefined ? { jsonLd } : {}),
  });
}

function normalizeJsonLd(input: unknown): JsonLd {
  if (!input || typeof input !== 'object') throw new TypeError('HEAD_INVALID: jsonLd must be an object or array');
  if (Array.isArray(input) && (!input.length || input.length > 32 || input.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry)))) {
    throw new TypeError('HEAD_INVALID: jsonLd arrays must contain 1 to 32 objects');
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(input, (_key, value) => {
      if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint'
        || (typeof value === 'number' && !Number.isFinite(value))) throw new TypeError();
      return value;
    });
  } catch { throw new TypeError('HEAD_INVALID: jsonLd must be JSON-serializable'); }
  if (serialized.length > 65536) throw new TypeError('HEAD_INVALID: jsonLd exceeds 64 KiB');
  return JSON.parse(serialized) as JsonLd;
}

/** JSON for a `<script type="application/ld+json">`; `<` is escaped so a value cannot close the tag. */
export function serializeJsonLd(value: JsonLd): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

/**
 * Merge `meta.head` from the root match down: the deepest title wins, metas merge with a deeper entry of the same
 * name/property replacing the ancestor one, links merge by rel+href, and jsonLd is replaced by the deepest block.
 * Sibling routes never influence each other.
 */
export function collectHead(routes: readonly RouteObject[], pathname: string, basename = '/'): RouteHead {
  // Router state carries the basename-stripped pathname; accept a full pathname too without guessing twice.
  const matches = matchRoutes(routes as RouteObject[], pathname, basename) ?? matchRoutes(routes as RouteObject[], pathname, '/');
  if (!matches) return Object.freeze({});
  let title: string | undefined, jsonLd: JsonLd | undefined;
  const metas = new Map<string, HeadMeta>(), links = new Map<string, HeadLink>();
  for (const match of matches) {
    const handle = match.route.handle as { cormi?: { meta?: Record<string, unknown> } } | undefined;
    const head = normalizeHead(handle?.cormi?.meta?.head);
    if (head.title !== undefined) title = head.title;
    if (head.jsonLd !== undefined) jsonLd = head.jsonLd;
    for (const meta of head.metas ?? []) metas.set(meta.name !== undefined ? `name:${meta.name}` : `property:${meta.property}`, meta);
    for (const link of head.links ?? []) links.set(`${link.rel} ${link.href}`, link);
  }
  return Object.freeze({
    ...(title !== undefined ? { title } : {}),
    ...(metas.size ? { metas: Object.freeze([...metas.values()]) } : {}),
    ...(links.size ? { links: Object.freeze([...links.values()]) } : {}),
    ...(jsonLd !== undefined ? { jsonLd } : {}),
  });
}

interface HeadState {
  readonly options: HeadOptions;
  readonly initialTitle: string;
}

const states = new WeakMap<AbortSignal, HeadState>();

function removeManaged(document: Document) {
  for (const node of [...document.querySelectorAll(`[${HEAD_ATTRIBUTE}]`)]) node.parentNode?.removeChild(node);
}

function apply(routes: readonly RouteObject[], pathname: string, basename: string, state: HeadState) {
  if (typeof document === 'undefined') return;
  const head = collectHead(routes, pathname, basename);
  const title = head.title === undefined ? state.initialTitle : `${head.title}${state.options.titleTemplate ?? ''}`;
  if (document.title !== title) document.title = title;
  removeManaged(document);
  for (const meta of head.metas ?? []) {
    const node = document.createElement('meta');
    node.setAttribute(HEAD_ATTRIBUTE, '');
    if (meta.name !== undefined) node.setAttribute('name', meta.name); else node.setAttribute('property', meta.property!);
    node.setAttribute('content', meta.content);
    document.head.appendChild(node);
  }
  for (const link of head.links ?? []) {
    const node = document.createElement('link');
    node.setAttribute(HEAD_ATTRIBUTE, '');
    node.setAttribute('rel', link.rel);
    node.setAttribute('href', link.href);
    document.head.appendChild(node);
  }
  if (head.jsonLd !== undefined) {
    const node = document.createElement('script');
    node.setAttribute(HEAD_ATTRIBUTE, '');
    node.setAttribute('type', 'application/ld+json');
    node.textContent = serializeJsonLd(head.jsonLd);
    document.head.appendChild(node);
  }
}

export interface RouteHeadRuntimeOptions extends HeadOptions {
  /** When false only the plugin's explicit API is used; defaults to syncing every route change. */
  readonly auto?: boolean;
}

/** Runtime plugin that mirrors the deepest route's `meta.head` into the document. */
export const routeHeadRuntime = {
  setup({ options, signal }: { readonly options: unknown; readonly signal: AbortSignal }) {
    const parsed = (options ?? {}) as RouteHeadRuntimeOptions;
    const state: HeadState = {
      options: {
        ...(typeof parsed.titleTemplate === 'string' ? { titleTemplate: parsed.titleTemplate } : {}),
        ...(typeof parsed.baseTitle === 'string' ? { baseTitle: parsed.baseTitle } : {}),
      },
      initialTitle: typeof document === 'undefined' ? '' : parsed.baseTitle ?? document.title,
    };
    states.set(signal, state);
    return () => {
      states.delete(signal);
      if (typeof document === 'undefined') return;
      removeManaged(document);
      if (document.title !== state.initialTitle) document.title = state.initialTitle;
    };
  },
  onRouteChange(location: Readonly<{ pathname: string }>, event: RouteChangeEvent, context?: { readonly signal: AbortSignal; readonly options: unknown }) {
    const state = context && states.get(context.signal);
    if (!state || (context.options as RouteHeadRuntimeOptions | undefined)?.auto === false) return;
    apply(event.clientRoutes, location.pathname, event.basename, state);
  },
};
