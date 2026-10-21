import { CormiError, type Plugin } from '@cormijs/core';
import react from '@vitejs/plugin-react';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build as viteBuild, type PreviewServer, type ResolvedConfig, type ViteDevServer } from 'vite';
import type {} from '@cormijs/plugin-vite';

export interface SsrPluginOptions {
  readonly id?: string;
  /** Client mount element replaced with server markup; default `root`. */
  readonly mountId?: string;
}

type Render = (request: Request) => Promise<unknown>;
type Load = (request: Request) => Promise<Response>;
const hydrationPattern = /<script>window\.__staticRouterHydrationData = [\s\S]*?<\/script>/;

const entrySource = `import { renderServerApplication, renderServerLoaderData } from '@cormijs/runtime/server';
import { cormiApplication } from './app';
import { serverLoaders } from './server-loaders';
const application = { ...cormiApplication, serverLoaders };
export const render = (request) => renderServerApplication(application, request);
export const load = (request) => renderServerLoaderData(application, request);
`;

export function serverLoaderPath(base: string): string {
  return `${base === '/' ? '/' : base}.cormi/server-loader`;
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

/** Opt-in SSR: dev renders through Vite's SSR module graph, preview through a built server bundle. */
export const ssrPlugin: Plugin.Object<SsrPluginOptions> = {
  name: 'cormi:ssr', inject: ['vite'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'mountId'].includes(key))) {
      throw new CormiError('SSR_INVALID', 'Invalid SSR plugin options.');
    }
    const id = options.id ?? 'cormi:ssr';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('SSR_INVALID', 'Invalid SSR plugin id.');
    const mountId = options.mountId ?? 'root';
    if (typeof mountId !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(mountId)) throw new CormiError('SSR_INVALID', 'Invalid SSR mount id.', { mountId });
    ctx.effect(() => ctx.vite.add(id, () => {
      let resolved: ResolvedConfig | undefined;
      let building = false;
      const serverOut = () => resolved ? join(resolved.build.outDir, '.cormi/ssr') : '';
      const entryFile = () => resolved ? join(resolved.root, '.cormi', 'ssr.tsx') : '';

      const devModule = async (server: ViteDevServer): Promise<{ render: Render; load: Load }> => {
        const entry = entryFile();
        await mkdir(join(server.config.root, '.cormi'), { recursive: true });
        await writeFile(entry, entrySource);
        const module = await server.ssrLoadModule('/.cormi/ssr.tsx') as { render?: unknown; load?: unknown };
        if (typeof module.render !== 'function' || typeof module.load !== 'function') throw new CormiError('SSR_BUILD_INVALID', 'SSR entry has no render/load export.');
        return module as { render: Render; load: Load };
      };

      const devRender = async (server: ViteDevServer, request: import('node:http').IncomingMessage): Promise<Response> => {
        const module = await devModule(server);
        const result = await module.render(toRequest(request));
        if (result instanceof Response) return result;
        const shell = await server.transformIndexHtml(request.url ?? '/', await readFile(join(server.config.root, 'index.html'), 'utf8'));
        return injectShell(shell, result as { html?: unknown }, mountId);
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
              try { return sendResult(await devRender(server, request), response, request.method === 'HEAD'); }
              catch (error) { console.error('[cormi:ssr]', error); next(); }
            })();
          });
        },
        configurePreviewServer(server: PreviewServer) {
          const shellFile = join(server.config.build.outDir, 'index.html'), moduleFile = join(serverOut(), 'ssr.mjs');
          let handler: Promise<{ render: Render; load: Load }> | undefined;
          const loadModule = () => handler ??= import(pathToFileURL(moduleFile).href).then((module: { render?: unknown; load?: unknown }) => {
            if (typeof module.render !== 'function' || typeof module.load !== 'function') throw new CormiError('SSR_BUILD_INVALID', 'SSR bundle has no render/load export.');
            return module as { render: Render; load: Load };
          });
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
                const result = await (await loadModule()).render(toRequest(request));
                if (result instanceof Response) return sendResult(result, response, request.method === 'HEAD');
                return sendResult(injectShell(await readFile(shellFile, 'utf8'), result as { html?: unknown }, mountId), response, request.method === 'HEAD');
              } catch (error) { console.error('[cormi:ssr]', error); next(); }
            })();
          });
        },
      };
    }));
  },
};
