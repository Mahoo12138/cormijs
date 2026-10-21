import { CormiError, type Plugin } from '@cormijs/core';
import react from '@vitejs/plugin-react';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build as viteBuild, type PreviewServer, type ResolvedConfig, type ViteDevServer } from 'vite';
import type {} from '@cormijs/plugin-vite';
import type {} from '@cormijs/plugin-react';
import type { RouteRecord } from '@cormijs/routes';
import type { ServerStreamResult } from '@cormijs/runtime/server';
import { staticPages, type StaticPage } from './static-export.js';

export interface PrerenderPathEntry {
  readonly path: string;
  /** Set false to keep the path out of this build while retaining it in configuration. */
  readonly prerender?: boolean;
}
export type PrerenderPath = string | PrerenderPathEntry;
export interface SsrPluginOptions {
  readonly id?: string;
  /** Client mount element replaced with server markup; default `root`. */
  readonly mountId?: string;
  /** Render every literal route into its own HTML file after the SSR bundle is built. */
  readonly prerender?: boolean;
  /** Extra application paths (or an async path producer) to prerender; object entries can disable a path. */
  readonly prerenderPaths?: readonly PrerenderPath[] | (() => readonly PrerenderPath[] | Promise<readonly PrerenderPath[]>);
  /** Log and skip pages whose render throws instead of failing the build. */
  readonly prerenderIgnoreErrors?: boolean;
  /** Keep existing HTML files when their rendered content is unchanged. */
  readonly prerenderIncremental?: boolean;
  /** Absolute site origin used to write sitemap.xml for prerendered routes. Requires prerender. */
  readonly sitemap?: string;
  /** Stream HTML through React's streaming renderer instead of buffering the whole page. */
  readonly streaming?: boolean;
}

type Render = (request: Request) => Promise<unknown>;
type StreamRender = (request: Request) => Promise<ServerStreamResult | Response>;
type Load = (request: Request) => Promise<Response>;
const hydrationPattern = /<script>window\.__staticRouterHydrationData = [\s\S]*?<\/script>/;

const entrySource = `import { renderServerApplication, renderServerApplicationStream, renderServerLoaderData } from '@cormijs/runtime/server';
import { cormiApplication } from './app';
import { serverLoaders } from './server-loaders';
const application = { ...cormiApplication, serverLoaders };
export const render = (request) => renderServerApplication(application, request);
export const renderStream = (request) => renderServerApplicationStream(application, request);
export const load = (request) => renderServerLoaderData(application, request);
`;

export function serverLoaderPath(base: string): string {
  return `${base === '/' ? '/' : base}.cormi/server-loader`;
}

/** Empty SSR shell kept apart from prerendered index.html; preview and serve must not reuse filled markup. */
export function serverShellPath(outDir: string): string {
  return join(outDir, '.cormi', 'shell.html');
}

export async function readServerShell(outDir: string): Promise<string> {
  try { return await readFile(serverShellPath(outDir), 'utf8'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return readFile(join(outDir, 'index.html'), 'utf8');
  }
}

/** Rebuilds the client-side fallback request from `?url=`; returns undefined when this is another request. */
export function serverLoaderRequest(request: import('node:http').IncomingMessage, base: string): Request | undefined {
  if (request.method !== 'GET') return undefined;
  const endpoint = new URL(request.url ?? '/', 'http://localhost');
  if (endpoint.pathname !== serverLoaderPath(base)) return undefined;
  const target = endpoint.searchParams.get('url') ?? '/';
  if (!target.startsWith('/') || target.startsWith('//') || target.length > 4096) return new Request('http://localhost/invalid', { method: 'GET' });
  return new Request(new URL(target, `http://${typeof request.headers.host === 'string' ? request.headers.host : 'localhost'}`), { method: 'GET', headers: toRequest(request).headers });
}

export function sendLoaderFailure(response: import('node:http').ServerResponse, error: unknown): void {
  console.error('[cormi:ssr:server-loader]', error);
  response.statusCode = 500;
  response.setHeader('content-type', 'application/json; charset=utf-8');
  response.end(JSON.stringify({ error: 'SERVER_LOADER_FAILED' }));
}

/** Writes the shell around a streaming render; hydration script is appended outside the mount root. */
export async function sendShellStream(result: ServerStreamResult, shell: string, mountId: string,
  response: import('node:http').ServerResponse, head: boolean): Promise<void> {
  const marker = `<div id="${mountId}"></div>`;
  if (!shell.includes(marker)) throw new CormiError('SSR_SHELL_INVALID', 'index.html has no empty mount element.', { mountId });
  const injected = injectHead(shell, result.head);
  const index = injected.indexOf(marker);
  const prefix = injected.slice(0, index), suffix = injected.slice(index + marker.length);
  response.statusCode = result.status;
  for (const [name, value] of result.headers) response.setHeader(name, value);
  response.setHeader('content-type', 'text/html; charset=utf-8');
  if (head) { await result.stream.cancel().catch(() => {}); response.end(); return; }
  const reader = result.stream.getReader();
  let closed = false;
  const abandon = () => { closed = true; void reader.cancel().catch(() => {}); };
  response.once('close', abandon);
  response.write(prefix + `<div id="${mountId}">`);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) response.write(value);
    }
    if (closed) return;
    const hydration = await result.hydration;
    response.off('close', abandon);
    response.end(`</div>${hydration}${suffix}`);
  } catch (error) {
    response.off('close', abandon);
    throw error;
  }
}

export function sendResult(response: Response, res: import('node:http').ServerResponse, head: boolean): Promise<void> {
  return (async () => {
    res.statusCode = response.status;
    for (const [name, value] of response.headers) res.setHeader(name, value);
    const body = Buffer.from(await response.arrayBuffer());
    res.setHeader('content-length', body.byteLength);
    res.end(head ? undefined : body);
  })();
}

export function toRequest(request: import('node:http').IncomingMessage): Request {
  const url = new URL(request.url ?? '/', `http://${typeof request.headers.host === 'string' ? request.headers.host : 'localhost'}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) if (value !== undefined && name !== 'content-length' && name !== 'transfer-encoding') {
    if (Array.isArray(value)) for (const item of value) headers.append(name, item); else headers.set(name, value);
  }
  return new Request(url, { method: request.method, headers });
}

export interface ServerHead { readonly title?: string; readonly metas?: readonly { readonly name?: string; readonly property?: string; readonly content: string }[];
  readonly links?: readonly { readonly rel: string; readonly href: string }[]; readonly jsonLd?: unknown }
const attr = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Mirrors the head plugin's output as managed tags so the client can replace them after hydration. */
export function injectHead(shell: string, head: unknown): string {
  if (!head || typeof head !== 'object' || Array.isArray(head)) return shell;
  const value = head as ServerHead;
  let output = shell;
  if (typeof value.title === 'string') {
    const title = `<title>${attr(value.title)}</title>`;
    output = /<title[^>]*>[\s\S]*?<\/title>/i.test(output) ? output.replace(/<title[^>]*>[\s\S]*?<\/title>/i, title) : output.replace(/<\/head>/i, `${title}</head>`);
  }
  const tags: string[] = [];
  for (const meta of value.metas ?? []) tags.push(`<meta ${meta.name !== undefined ? `name="${attr(meta.name)}"` : `property="${attr(meta.property ?? '')}"`} content="${attr(meta.content)}" data-cormi-head="" />`);
  for (const link of value.links ?? []) tags.push(`<link rel="${attr(link.rel)}" href="${attr(link.href)}" data-cormi-head="" />`);
  if (value.jsonLd !== undefined) tags.push(`<script type="application/ld+json" data-cormi-head="">${JSON.stringify(value.jsonLd).replace(/</g, '\\u003c')}</script>`);
  return tags.length ? output.replace(/<\/head>/i, `${tags.join('')}</head>`) : output;
}

export function injectShell(shell: string, rendered: { html?: unknown; status?: unknown; headers?: unknown; head?: unknown }, mountId: string): Response {
  if (typeof rendered.html !== 'string') throw new CormiError('SSR_RENDER_INVALID', 'SSR result has no html.');
  const marker = `<div id="${mountId}"></div>`;
  if (!shell.includes(marker)) throw new CormiError('SSR_SHELL_INVALID', 'index.html has no empty mount element.', { mountId });
  const hydration = hydrationPattern.exec(rendered.html)?.[0] ?? '';
  const markup = hydration ? rendered.html.replace(hydration, '') : rendered.html;
  const headers = rendered.headers instanceof Headers ? rendered.headers : new Headers();
  headers.set('content-type', 'text/html; charset=utf-8');
  shell = injectHead(shell, rendered.head);
  // Hydration data must execute before the client module, but must not become a child of the hydration root.
  return new Response(shell.replace(marker, `<div id="${mountId}">${markup}</div>${hydration}`), {
    status: typeof rendered.status === 'number' ? rendered.status : 200, headers,
  });
}

export function withinBase(request: import('node:http').IncomingMessage, base: string): boolean {
  if (base === '/') return true;
  const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
  const prefix = base.endsWith('/') ? base.slice(0, -1) : base;
  return pathname === prefix || pathname.startsWith(prefix + '/');
}

export function navigation(request: import('node:http').IncomingMessage): boolean {
  const accept = request.headers.accept ?? '';
  return (request.method === 'GET' || request.method === 'HEAD') && accept.includes('text/html')
    && !request.url?.startsWith('/.cormi/') && !request.url?.startsWith('/assets/');
}

const xml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
export function sitemapXml(urls: readonly string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(url => `  <url><loc>${xml(url)}</loc></url>`).join('\n')}${urls.length ? '\n' : ''}</urlset>\n`;
}

function sitemapSite(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 2048) throw new CormiError('SSR_INVALID', 'sitemap must be an absolute site URL.');
  let url: URL;
  try { url = new URL(value); } catch { throw new CormiError('SSR_INVALID', 'sitemap must be an absolute site URL.'); }
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash) {
    throw new CormiError('SSR_INVALID', 'sitemap must be a plain http(s) site URL.');
  }
  return value.replace(/\/+$/, '');
}

function publicUrl(site: string, base: string, path: string): string {
  const prefix = base.endsWith('/') ? base : `${base}/`;
  return `${site}${prefix}${path === '/' ? '' : path.slice(1)}`;
}

function extraPrerenderPaths(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 10000) throw new CormiError('SSR_INVALID', 'prerenderPaths must be an array of at most 10000 paths.');
  const paths = new Set<string>();
  for (const raw of value) {
    let path: unknown = raw, prerender = true;
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      const entry = raw as Record<string, unknown>;
      if (Object.keys(entry).some(key => !['path', 'prerender'].includes(key)) || typeof entry.path !== 'string'
        || entry.prerender !== undefined && typeof entry.prerender !== 'boolean') {
        throw new CormiError('SSR_INVALID', 'prerenderPaths entries must be a path string or { path, prerender? }.');
      }
      path = entry.path;
      prerender = entry.prerender !== false;
    }
    if (!prerender) continue;
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.length > 512 || /[\0\r\n?#%\\]/.test(path)
      || path.split('/').some(segment => segment === '..' || segment === '.')) throw new CormiError('SSR_INVALID', 'prerenderPaths entries must be internal application paths.');
    paths.add(path === '/' ? '/' : path.replace(/\/+$/, ''));
  }
  return Object.freeze([...paths].sort());
}

/** Resolve an array or async path producer (Umi extraRoutePaths) with per-page disable and validation. */
export async function resolvePrerenderPaths(value: SsrPluginOptions['prerenderPaths']): Promise<readonly string[]> {
  if (value === undefined) return Object.freeze([]);
  if (typeof value !== 'function' && !Array.isArray(value)) throw new CormiError('SSR_INVALID', 'prerenderPaths must be an array or an async function.');
  const paths = typeof value === 'function' ? await value() : value;
  return extraPrerenderPaths(paths);
}

/** Literal route pages plus explicit extra paths; extra paths use the SSR render result for their head. */
export function prerenderPages(routes: readonly RouteRecord[], extraPaths: readonly string[] = []): readonly StaticPage[] {
  const pages = new Map<string, StaticPage>();
  for (const page of staticPages(routes)) pages.set(page.path, page);
  for (const path of extraPaths) if (!pages.has(path)) pages.set(path, { path, head: {} });
  return Object.freeze([...pages.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
}

export interface PrerenderOptions {
  readonly output: string;
  readonly shell: string;
  readonly mountId: string;
  readonly base: string;
  readonly pages: readonly StaticPage[];
  readonly render: Render;
  readonly sitemap?: string;
  readonly ignoreErrors?: boolean;
  readonly incremental?: boolean;
}
export interface PrerenderResult {
  readonly written: readonly string[];
  readonly unchanged: readonly string[];
  readonly skipped: readonly { readonly path: string; readonly status: number; readonly error?: string }[];
  readonly sitemap?: string;
}

/**
 * Renders literal routes through the built SSR bundle. Pages whose loader returns a Response are skipped
 * (redirects cannot be frozen into HTML); their paths are excluded from the sitemap.
 */
export async function prerenderStaticPages(options: PrerenderOptions): Promise<PrerenderResult> {
  const written: string[] = [], unchanged: string[] = [], skipped: { path: string; status: number; error?: string }[] = [], urls: string[] = [];
  for (const page of options.pages) {
    const target = page.path === '/' ? join(options.output, 'index.html') : join(options.output, ...page.path.split('/').filter(Boolean), 'index.html');
    const local = relative(options.output, target);
    if (!local || isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) throw new CormiError('SSR_PRERENDER_FAILED', 'Prerendered pages must stay inside the output.', { path: page.path });
    const url = new URL(`${options.base}${page.path === '/' ? '' : page.path.slice(1)}`, 'http://localhost');
    try {
      const rendered = await options.render(new Request(url));
      if (rendered instanceof Response) { skipped.push({ path: page.path, status: rendered.status }); continue; }
      const status = (rendered as { status?: unknown }).status;
      if (typeof status === 'number' && status >= 400) { skipped.push({ path: page.path, status }); continue; }
      const html = await injectShell(options.shell, rendered as { html?: unknown }, options.mountId).text();
      if (options.incremental) {
        const existing = await readFile(target, 'utf8').catch((error: NodeJS.ErrnoException) => error.code === 'ENOENT' ? undefined : Promise.reject(error));
        if (existing === html) {
          unchanged.push(page.path);
          if (options.sitemap) urls.push(publicUrl(options.sitemap, options.base, page.path));
          continue;
        }
      }
      if (page.path !== '/') await mkdir(dirname(target), { recursive: true });
      await writeFile(target, html);
      written.push(page.path);
      if (options.sitemap) urls.push(publicUrl(options.sitemap, options.base, page.path));
    } catch (error) {
      if (!options.ignoreErrors) throw error;
      skipped.push({ path: page.path, status: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
  let sitemap: string | undefined;
  if (options.sitemap) {
    sitemap = join(options.output, 'sitemap.xml');
    await writeFile(sitemap, sitemapXml(urls));
  }
  return Object.freeze({ written: Object.freeze(written), unchanged: Object.freeze(unchanged), skipped: Object.freeze(skipped), ...(sitemap ? { sitemap } : {}) });
}

/** Opt-in SSR: dev renders through Vite's SSR module graph, preview through a built server bundle. */
export const ssrPlugin: Plugin.Object<SsrPluginOptions> = {
  name: 'cormi:ssr', inject: ['vite', 'react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'mountId', 'prerender', 'prerenderPaths', 'prerenderIgnoreErrors', 'prerenderIncremental', 'sitemap', 'streaming'].includes(key))) {
      throw new CormiError('SSR_INVALID', 'Invalid SSR plugin options.');
    }
    if (options.prerender !== undefined && typeof options.prerender !== 'boolean') throw new CormiError('SSR_INVALID', 'prerender must be boolean.');
    if (options.streaming !== undefined && typeof options.streaming !== 'boolean') throw new CormiError('SSR_INVALID', 'streaming must be boolean.');
    if (options.prerenderIgnoreErrors !== undefined && typeof options.prerenderIgnoreErrors !== 'boolean') throw new CormiError('SSR_INVALID', 'prerenderIgnoreErrors must be boolean.');
    if (options.prerenderIncremental !== undefined && typeof options.prerenderIncremental !== 'boolean') throw new CormiError('SSR_INVALID', 'prerenderIncremental must be boolean.');
    if (options.prerenderPaths !== undefined && typeof options.prerenderPaths !== 'function' && !Array.isArray(options.prerenderPaths)) throw new CormiError('SSR_INVALID', 'prerenderPaths must be an array or an async function.');
    if (options.prerenderPaths !== undefined && options.prerender !== true) throw new CormiError('SSR_INVALID', 'prerenderPaths requires prerender: true.');
    if (options.prerenderIgnoreErrors !== undefined && options.prerender !== true) throw new CormiError('SSR_INVALID', 'prerenderIgnoreErrors requires prerender: true.');
    if (options.prerenderIncremental !== undefined && options.prerender !== true) throw new CormiError('SSR_INVALID', 'prerenderIncremental requires prerender: true.');
    if (Array.isArray(options.prerenderPaths)) extraPrerenderPaths(options.prerenderPaths);
    const sitemap = options.sitemap === undefined ? undefined : sitemapSite(options.sitemap);
    if (sitemap !== undefined && options.prerender !== true) throw new CormiError('SSR_INVALID', 'sitemap requires prerender: true.');
    const id = options.id ?? 'cormi:ssr';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('SSR_INVALID', 'Invalid SSR plugin id.');
    const mountId = options.mountId ?? 'root';
    if (typeof mountId !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(mountId)) throw new CormiError('SSR_INVALID', 'Invalid SSR mount id.', { mountId });
    ctx.effect(() => ctx.vite.add(id, () => {
      let resolved: ResolvedConfig | undefined;
      let building = false;
      const serverOut = () => resolved ? join(resolved.build.outDir, '.cormi/ssr') : '';
      const entryFile = () => resolved ? join(resolved.root, '.cormi', 'ssr.tsx') : '';

      const devModule = async (server: ViteDevServer): Promise<{ render: Render; load: Load; renderStream?: StreamRender }> => {
        const entry = entryFile();
        await mkdir(join(server.config.root, '.cormi'), { recursive: true });
        await writeFile(entry, entrySource);
        const module = await server.ssrLoadModule('/.cormi/ssr.tsx') as { render?: unknown; load?: unknown; renderStream?: unknown };
        if (typeof module.render !== 'function' || typeof module.load !== 'function'
          || options.streaming === true && typeof module.renderStream !== 'function') throw new CormiError('SSR_BUILD_INVALID', 'SSR entry has no render/load/renderStream export.');
        return module as { render: Render; load: Load; renderStream?: StreamRender };
      };

      const devRespond = async (server: ViteDevServer, request: import('node:http').IncomingMessage, response: import('node:http').ServerResponse): Promise<void> => {
        const head = request.method === 'HEAD';
        const module = await devModule(server);
        if (options.streaming === true) {
          const result = await module.renderStream!(toRequest(request));
          if (result instanceof Response) return sendResult(result, response, head);
          const shell = await server.transformIndexHtml(request.url ?? '/', await readFile(join(server.config.root, 'index.html'), 'utf8'));
          return sendShellStream(result, shell, mountId, response, head);
        }
        const result = await module.render(toRequest(request));
        if (result instanceof Response) return sendResult(result, response, head);
        const shell = await server.transformIndexHtml(request.url ?? '/', await readFile(join(server.config.root, 'index.html'), 'utf8'));
        return sendResult(injectShell(shell, result as { html?: unknown }, mountId), response, head);
      };

      return {
        name: id,
        configResolved(config) { resolved = config; building = config.command === 'build'; },
        async closeBundle() {
          if (!building) { if (resolved) await rm(entryFile(), { force: true }); return; }
          if (!resolved) return;
          await mkdir(join(resolved.root, '.cormi'), { recursive: true });
          await writeFile(entryFile(), entrySource);
          try {
            await viteBuild({
              root: resolved.root, configFile: false, mode: resolved.mode, base: resolved.base, define: resolved.define,
              resolve: { alias: resolved.resolve.alias, dedupe: resolved.resolve.dedupe, extensions: resolved.resolve.extensions },
              publicDir: false, logLevel: 'silent', clearScreen: false, plugins: [react()],
              build: { ssr: entryFile(), outDir: serverOut(), emptyOutDir: true, write: true, minify: false, target: 'node22', ssrEmitAssets: false,
                rollupOptions: { output: { entryFileNames: 'ssr.mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' } } },
              ssr: { noExternal: true, target: 'node' },
            });
          } catch (cause) {
            throw new CormiError('SSR_BUILD_FAILED', 'The SSR bundle could not be built.', {}, { cause });
          } finally {
            await rm(entryFile(), { force: true });
          }
          if (options.prerender === true) {
            try {
              const routes = await ctx.react.routes.reduce([] as readonly RouteRecord[], (value): value is readonly RouteRecord[] => Array.isArray(value));
              const module = await import(pathToFileURL(join(serverOut(), 'ssr.mjs')).href) as { render?: unknown };
              if (typeof module.render !== 'function') throw new CormiError('SSR_BUILD_INVALID', 'SSR bundle has no render export.');
              const shell = await readFile(join(resolved.build.outDir, 'index.html'), 'utf8');
              await mkdir(join(resolved.build.outDir, '.cormi'), { recursive: true });
              await writeFile(serverShellPath(resolved.build.outDir), shell);
              const extraPaths = await resolvePrerenderPaths(options.prerenderPaths);
              const result = await prerenderStaticPages({ output: resolved.build.outDir, shell, mountId, base: resolved.base,
                pages: prerenderPages(routes, extraPaths), render: module.render as Render, ignoreErrors: options.prerenderIgnoreErrors === true,
                incremental: options.prerenderIncremental === true, ...(sitemap !== undefined ? { sitemap } : {}) });
              if (result.skipped.length) console.warn('[cormi:ssr:prerender] skipped routes', JSON.stringify(result.skipped));
            } catch (cause) {
              if (cause instanceof CormiError) throw cause;
              throw new CormiError('SSR_PRERENDER_FAILED', 'Prerendering failed.', {}, { cause });
            }
          }
        },
        configureServer(server) {
          server.middlewares.use((request, response, next) => {
            const loader = serverLoaderRequest(request, server.config.base);
            if (loader) {
              void (async () => {
                try { return sendResult(await (await devModule(server)).load(loader), response, false); }
                catch (error) { sendLoaderFailure(response, error); }
              })();
              return;
            }
            if (!navigation(request) || !withinBase(request, server.config.base)) return next();
            void (async () => {
              try { return await devRespond(server, request, response); }
              catch (error) {
                console.error('[cormi:ssr]', error);
                if (response.headersSent) response.destroy(); else next();
              }
            })();
          });
        },
        configurePreviewServer(server: PreviewServer) {
          const outDir = server.config.build.outDir, moduleFile = join(serverOut(), 'ssr.mjs');
          let handler: Promise<{ render: Render; load: Load; renderStream?: StreamRender }> | undefined, shell: Promise<string> | undefined;
          const loadModule = () => handler ??= import(pathToFileURL(moduleFile).href).then((module: { render?: unknown; load?: unknown; renderStream?: unknown }) => {
            if (typeof module.render !== 'function' || typeof module.load !== 'function'
              || options.streaming === true && typeof module.renderStream !== 'function') throw new CormiError('SSR_BUILD_INVALID', 'SSR bundle has no render/load/renderStream export.');
            return module as { render: Render; load: Load; renderStream?: StreamRender };
          });
          const loadShell = () => shell ??= readServerShell(outDir);
          server.middlewares.use((request, response, next) => {
            const loader = serverLoaderRequest(request, server.config.base);
            if (loader) {
              void (async () => {
                try { return sendResult(await (await loadModule()).load(loader), response, false); }
                catch (error) { sendLoaderFailure(response, error); }
              })();
              return;
            }
            if (!navigation(request) || !withinBase(request, server.config.base)) return next();
            void (async () => {
              try {
                const module = await loadModule(), head = request.method === 'HEAD';
                if (options.streaming === true) {
                  const result = await module.renderStream!(toRequest(request));
                  if (result instanceof Response) return sendResult(result, response, head);
                  return sendShellStream(result, await loadShell(), mountId, response, head);
                }
                const result = await module.render(toRequest(request));
                if (result instanceof Response) return sendResult(result, response, head);
                return sendResult(injectShell(await loadShell(), result as { html?: unknown }, mountId), response, head);
              } catch (error) {
                console.error('[cormi:ssr]', error);
                if (response.headersSent) response.destroy(); else next();
              }
            })();
          });
        },
      };
    }));
  },
};
