import { CormiError, type Plugin } from '@cormijs/core';
import react from '@vitejs/plugin-react';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build as viteBuild, type ResolvedConfig } from 'vite';
import type {} from '@cormijs/plugin-vite';

export interface SsrPluginOptions {
  readonly id?: string;
  /** Client mount element replaced with server markup; default `root`. */
  readonly mountId?: string;
}

const entrySource = `import { renderServerApplication } from '@cormijs/runtime/server';
import { cormiApplication } from './app';
export const render = (request) => renderServerApplication(cormiApplication, request);
`;

function sendResult(response: Response, res: import('node:http').ServerResponse, head: boolean): Promise<void> {
  return (async () => {
    res.statusCode = response.status;
    for (const [name, value] of response.headers) res.setHeader(name, value);
    const body = Buffer.from(await response.arrayBuffer());
    res.setHeader('content-length', body.byteLength);
    res.end(head ? undefined : body);
  })();
}

/** Opt-in production SSR: builds a server entry beside the client bundle and renders in preview. */
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
      return {
        name: id,
        configResolved(config) { resolved = config; building = config.command === 'build'; },
        async closeBundle() {
          if (!building || !resolved) return;
          if (resolved.base !== '/') throw new CormiError('SSR_BASE_UNSUPPORTED', 'SSR currently requires app.base to be /.', { base: resolved.base });
          const entryFile = join(resolved.root, '.cormi', 'ssr.tsx');
          await mkdir(join(resolved.root, '.cormi'), { recursive: true });
          await writeFile(entryFile, entrySource);
          try {
            await viteBuild({
              root: resolved.root, configFile: false, mode: resolved.mode, base: resolved.base, define: resolved.define,
              resolve: { alias: resolved.resolve.alias, dedupe: resolved.resolve.dedupe, extensions: resolved.resolve.extensions },
              publicDir: false, logLevel: 'silent', clearScreen: false, plugins: [react()],
              build: { ssr: entryFile, outDir: serverOut(), emptyOutDir: true, write: true, minify: false, target: 'node22', ssrEmitAssets: false,
                rollupOptions: { output: { entryFileNames: 'ssr.mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' } } },
              ssr: { noExternal: true, target: 'node' },
            });
          } catch (cause) {
            throw new CormiError('SSR_BUILD_FAILED', 'The SSR bundle could not be built.', {}, { cause });
          } finally {
            await rm(entryFile, { force: true });
          }
        },
        configurePreviewServer(server) {
          const shellFile = join(server.config.build.outDir, 'index.html'), moduleFile = join(serverOut(), 'ssr.mjs');
          let handler: Promise<(request: Request) => Promise<unknown>> | undefined;
          server.middlewares.use((request, response, next) => {
            const accept = request.headers.accept ?? '';
            if ((request.method !== 'GET' && request.method !== 'HEAD') || !accept.includes('text/html')
              || request.url?.startsWith('/.cormi/') || request.url?.startsWith('/assets/')) return next();
            const task = (async () => {
              try {
                handler ??= import(pathToFileURL(moduleFile).href).then((module: { render?: unknown }) => {
                  if (typeof module.render !== 'function') throw new CormiError('SSR_BUILD_INVALID', 'SSR bundle has no render export.');
                  return module.render as (request: Request) => Promise<unknown>;
                });
                const render = await handler;
                const url = new URL(request.url ?? '/', `http://${typeof request.headers.host === 'string' ? request.headers.host : 'localhost'}`);
                const headers = new Headers();
                for (const [name, value] of Object.entries(request.headers)) if (value !== undefined && name !== 'content-length' && name !== 'transfer-encoding') {
                  if (Array.isArray(value)) for (const item of value) headers.append(name, item); else headers.set(name, value);
                }
                const result = await render(new Request(url, { method: request.method, headers }));
                if (result instanceof Response) return sendResult(result, response, request.method === 'HEAD');
                const rendered = result as { html?: unknown; status?: unknown; headers?: unknown };
                if (typeof rendered.html !== 'string') throw new CormiError('SSR_RENDER_INVALID', 'SSR result has no html.');
                const shell = await readFile(shellFile, 'utf8');
                const marker = `<div id="${mountId}"></div>`;
                if (!shell.includes(marker)) throw new CormiError('SSR_SHELL_INVALID', 'Built index.html has no empty mount element.', { mountId });
                const hydration = /<script>window\.__staticRouterHydrationData = [\s\S]*?<\/script>/.exec(rendered.html)?.[0] ?? '';
                const markup = hydration ? rendered.html.replace(hydration, '') : rendered.html;
                const body = shell.replace(marker, `<div id="${mountId}">${markup}</div>${hydration}`);
                const responseHeaders = rendered.headers instanceof Headers ? rendered.headers : new Headers();
                responseHeaders.set('content-type', 'text/html; charset=utf-8');
                return sendResult(new Response(request.method === 'HEAD' ? null : body, { status: typeof rendered.status === 'number' ? rendered.status : 200, headers: responseHeaders }), response, request.method === 'HEAD');
              } catch (error) {
                console.error('[cormi:ssr]', error);
                next();
              }
            })();
            void task;
          });
        },
      };
    }));
  },
};
