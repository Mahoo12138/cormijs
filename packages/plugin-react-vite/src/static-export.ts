import { CormiError, type Plugin } from '@cormijs/core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import type { RouteRecord } from '@cormijs/routes';
import type {} from '@cormijs/plugin-vite';
import type {} from '@cormijs/plugin-react';
import { applyHtmlHead, type HtmlLink, type HtmlMeta } from './html.js';

export interface StaticExportOptions {
  readonly id?: string;
  /** Appended to `meta.head.title` in every exported page, mirroring the runtime head plugin. */
  readonly titleTemplate?: string;
}
export interface StaticPage {
  /** Absolute application path, always starting with `/`. */
  readonly path: string;
  readonly head: { readonly title?: string; readonly metas?: readonly HtmlMeta[]; readonly links?: readonly HtmlLink[] };
}

const headOf = (route: RouteRecord): StaticPage['head'] => {
  const head = (route.meta as { head?: unknown } | undefined)?.head;
  if (!head || typeof head !== 'object' || Array.isArray(head)) return {};
  const value = head as Record<string, unknown>;
  const title = typeof value.title === 'string' && value.title && value.title.length <= 512 && !/[\0\r\n]/.test(value.title) ? value.title : undefined;
  const metas = Array.isArray(value.metas) ? value.metas.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    const selector = row.name !== undefined ? 'name' : row.property !== undefined ? 'property' : undefined;
    const label = selector ? row[selector] : undefined;
    if (!selector || typeof label !== 'string' || !label || typeof row.content !== 'string' || !row.content) return [];
    return [{ [selector]: label, content: row.content } as HtmlMeta];
  }) : undefined;
  const links = Array.isArray(value.links) ? value.links.flatMap(entry => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.rel !== 'string' || !row.rel || typeof row.href !== 'string' || !row.href) return [];
    return [{ rel: row.rel, href: row.href } as HtmlLink];
  }) : undefined;
  return Object.freeze({ ...(title !== undefined ? { title } : {}), ...(metas?.length ? { metas: Object.freeze(metas) } : {}), ...(links?.length ? { links: Object.freeze(links) } : {}) });
};

/**
 * Static SPA pages: every module route with a literal path gets its own HTML shell carrying that route's head.
 * Dynamic (`:id`) and catch-all routes cannot be addressed statically and are skipped; redirects have no page.
 */
export function staticPages(routes: readonly RouteRecord[]): readonly StaticPage[] {
  const byId = new Map(routes.map(route => [route.id, route]));
  const pathOf = (route: RouteRecord): string | undefined => {
    const segments: string[] = [];
    let current: RouteRecord | undefined = route;
    for (let depth = 0; current && depth < 128; depth++) {
      if (current.path !== undefined && current.path !== '') segments.unshift(current.path);
      current = current.parentId === undefined ? undefined : byId.get(current.parentId);
    }
    const path = '/' + segments.join('/');
    return path === '/' ? '/' : path.replace(/\/+$/, '');
  };
  const chain = (route: RouteRecord): RouteRecord[] => {
    const items: RouteRecord[] = [];
    let current: RouteRecord | undefined = route;
    for (let depth = 0; current && depth < 128; depth++) {
      items.unshift(current);
      current = current.parentId === undefined ? undefined : byId.get(current.parentId);
    }
    return items;
  };
  // Ancestor heads merge like the runtime: deeper titles win, metas replace by name/property, links dedupe.
  const merged = (route: RouteRecord): StaticPage['head'] => {
    let title: string | undefined;
    const metas = new Map<string, HtmlMeta>(), links = new Map<string, HtmlLink>();
    for (const entry of chain(route)) {
      const head = headOf(entry);
      if (head.title !== undefined) title = head.title;
      for (const meta of head.metas ?? []) metas.set(meta.name !== undefined ? `name:${meta.name}` : `property:${meta.property}`, meta);
      for (const link of head.links ?? []) links.set(`${link.rel} ${link.href}`, link);
    }
    return Object.freeze({ ...(title !== undefined ? { title } : {}), ...(metas.size ? { metas: Object.freeze([...metas.values()]) } : {}), ...(links.size ? { links: Object.freeze([...links.values()]) } : {}) });
  };
  const pages = new Map<string, StaticPage>();
  for (const route of routes) {
    if (!route.module || route.redirect !== undefined) continue;
    const path = pathOf(route);
    if (path === undefined || path.split('/').some(segment => segment.includes(':') || segment === '*')) continue;
    if (pages.has(path)) continue;
    pages.set(path, Object.freeze({ path, head: merged(route) }));
  }
  return Object.freeze([...pages.values()].sort((a, b) => (a.path < b.path ? -1 : 1)));
}

/** Apply a page head to the shared shell without touching author tags. */
export function renderStaticPage(html: string, page: StaticPage, titleTemplate = ''): string {
  const head = page.head;
  if (head.title === undefined && !head.metas && !head.links) return html;
  return applyHtmlHead(html, {
    ...(head.title !== undefined ? { title: `${head.title}${titleTemplate}` } : {}),
    ...(head.metas ? { metas: head.metas } : {}),
    ...(head.links ? { links: head.links } : {}),
  });
}

/** Writes one `index.html` per page; the application root keeps the built shell (with its head applied). */
export async function writeStaticPages(output: string, pages: readonly StaticPage[], titleTemplate = ''): Promise<readonly string[]> {
  const shell = await readFile(join(output, 'index.html'), 'utf8').catch((error: NodeJS.ErrnoException) => {
    throw error.code === 'ENOENT' ? new CormiError('STATIC_EXPORT_INVALID', 'The build did not produce index.html.') : error;
  });
  const written: string[] = [];
  const root = pages.find(page => page.path === '/');
  if (root) await writeFile(join(output, 'index.html'), renderStaticPage(shell, root, titleTemplate));
  for (const page of pages) {
    if (page.path === '/') continue;
    const target = join(output, ...page.path.split('/').filter(Boolean), 'index.html');
    const local = relative(output, target);
    if (!local || isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) throw new CormiError('STATIC_EXPORT_INVALID', 'Exported pages must stay inside the output.', { path: page.path });
    await mkdir(join(output, ...page.path.split('/').filter(Boolean)), { recursive: true });
    await writeFile(target, renderStaticPage(shell, page, titleTemplate));
    written.push(local.split(sep).join('/'));
  }
  return Object.freeze(written);
}

/** Opt-in build bridge: emits per-route HTML shells after bundling; it does not pre-render page content. */
export const staticExportPlugin: Plugin.Object<StaticExportOptions> = {
  name: 'cormi:static-export', inject: ['vite', 'react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'titleTemplate'].includes(key))) {
      throw new CormiError('STATIC_EXPORT_INVALID', 'Invalid static export plugin options.');
    }
    const id = options.id ?? 'cormi:static-export';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('STATIC_EXPORT_INVALID', 'Invalid static export id.');
    if (options.titleTemplate !== undefined && (typeof options.titleTemplate !== 'string' || options.titleTemplate.length > 512 || /[\0\r\n]/.test(options.titleTemplate))) {
      throw new CormiError('STATIC_EXPORT_INVALID', 'titleTemplate must be bounded text.');
    }
    let output = '';
    ctx.effect(() => ctx.vite.add(id, () => ({
      name: id, apply: 'build',
      configResolved(resolved) { output = resolved.build.outDir; },
      async closeBundle() {
        if (!output) return;
        const initial: readonly RouteRecord[] = [];
        const routes = await ctx.react.routes.reduce(initial, (value): value is readonly RouteRecord[] => Array.isArray(value));
        const pages = staticPages(routes);
        if (!pages.length) return;
        await writeStaticPages(output, pages, options.titleTemplate ?? '');
      },
    })));
  },
};
