import { CormiError, type Plugin } from '@cormijs/core';
import { createServer, type Server } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { extname, isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { injectShell, navigation, sendLoaderFailure, sendResult, serverLoaderRequest, toRequest, withinBase } from './ssr.js';

export interface ServePluginOptions {
  readonly id?: string;
  readonly mountId?: string;
  readonly host?: string;
  readonly port?: number;
  /** Project-relative build output; default `dist`. */
  readonly outDir?: string;
  /** Deployment prefix matching app.base; default `/`. */
  readonly base?: string;
}
type Render = (request: Request) => Promise<unknown>;
type Load = (request: Request) => Promise<Response>;
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.map': 'application/json; charset=utf-8',
};

function send(res: import('node:http').ServerResponse, status: number, body: string | Buffer, type = 'text/plain; charset=utf-8', head = false) {
  res.statusCode = status; res.setHeader('content-type', type); res.setHeader('content-length', Buffer.byteLength(body));
  res.end(head ? undefined : body);
}

/** Opt-in standalone server for a finished build; it does not run Vite, API routes or proxies. */
export const servePlugin: Plugin.Object<ServePluginOptions> = {
  name: 'cormi:serve', inject: ['commands', 'projectRoot'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'mountId', 'host', 'port', 'outDir', 'base'].includes(key))) {
      throw new CormiError('SERVE_INVALID', 'Invalid serve plugin options.');
    }
    const id = options.id ?? 'cormi:serve';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('SERVE_INVALID', 'Invalid serve plugin id.');
    const mountId = options.mountId ?? 'root';
    if (typeof mountId !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(mountId)) throw new CormiError('SERVE_INVALID', 'Invalid serve mount id.');
    const host = options.host ?? '127.0.0.1';
    if (typeof host !== 'string' || !host || host.length > 256) throw new CormiError('SERVE_INVALID', 'Invalid serve host.');
    const port = options.port ?? 4173;
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new CormiError('SERVE_INVALID', 'Invalid serve port.');
    const base = options.base ?? '/';
    if (typeof base !== 'string' || !base.startsWith('/') || !base.endsWith('/') || base.startsWith('//') || base.includes('\\') || base.split('/').includes('..')) throw new CormiError('SERVE_INVALID', 'base must be an absolute URL path ending with /.');
    const outDir = options.outDir ?? 'dist';
    if (typeof outDir !== 'string' || !outDir || isAbsolute(outDir) || outDir.split(/[\\/]/).some(part => !part || part === '..' || part === 'node_modules' || part === '.git')) {
      throw new CormiError('SERVE_INVALID', 'outDir must be a project-relative build directory.');
    }

    ctx.effect(() => ctx.commands.register('serve', async request => {
      request.signal.throwIfAborted();
      const output = join(ctx.projectRoot.root, outDir);
      const shellFile = join(output, 'index.html'), moduleFile = join(output, '.cormi/ssr/ssr.mjs');
      const [shell, info] = await Promise.all([readFile(shellFile, 'utf8'), stat(output)]).catch((error: NodeJS.ErrnoException) => {
        throw error.code === 'ENOENT' ? new CormiError('SERVE_BUILD_MISSING', 'Run cormi build with SSR enabled before cormi serve.', { output }) : error;
      });
      if (!info.isDirectory()) throw new CormiError('SERVE_BUILD_MISSING', 'Build output is not a directory.', { output });
      const module = await import(pathToFileURL(moduleFile).href).catch((cause) => {
        throw new CormiError('SERVE_BUILD_MISSING', 'SSR bundle is missing; build with app.ssr and ssrPlugin.', { module: moduleFile }, { cause });
      }) as { render?: unknown; load?: unknown };
      if (typeof module.render !== 'function' || typeof module.load !== 'function') throw new CormiError('SERVE_BUILD_INVALID', 'SSR bundle has no render/load export.');
      const render = module.render as Render, load = module.load as Load;
      const root = await realpath(output);
      const server: Server = createServer((req, res) => {
        void (async () => {
          try {
            const head = req.method === 'HEAD';
            if (req.method !== 'GET' && !head) return send(res, 405, 'Method Not Allowed');
            const requestPath = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname);
            if (requestPath.includes('\0')) return send(res, 400, 'Bad Request');
            const prefix = base === '/' ? '' : base.slice(0, -1);
            if (prefix && requestPath !== prefix && !requestPath.startsWith(prefix + '/')) {
              if (navigation(req)) { res.statusCode = 302; res.setHeader('location', base); res.end(); return; }
              return send(res, 404, 'Not Found');
            }
            const pathname = prefix ? (requestPath.slice(prefix.length) || '/') : requestPath;
            const loader = serverLoaderRequest(req, base);
            if (loader) {
              try { return sendResult(await load(loader), res, head); }
              catch (error) { return sendLoaderFailure(res, error); }
            }
            if (navigation(req)) {
              try {
                const result = await render(toRequest(req));
                if (result instanceof Response) return sendResult(result, res, head);
                return sendResult(injectShell(shell, result as { html?: unknown }, mountId), res, head);
              } catch (error) {
                console.error('[cormi:serve:ssr]', error);
                return send(res, 200, shell, mime['.html']!, head);
              }
            }
            const target = join(root, pathname.replace(/^\/+/, ''));
            const local = relative(root, target);
            if (isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) return send(res, 404, 'Not Found');
            try {
              const actual = await realpath(target);
              if (!actual.startsWith(root + sep) || !(await stat(actual)).isFile()) return send(res, 404, 'Not Found');
              return send(res, 200, await readFile(actual), mime[extname(actual).toLowerCase()] ?? 'application/octet-stream', head);
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') return send(res, 404, 'Not Found');
              throw error;
            }
          } catch (error) {
            console.error('[cormi:serve]', error);
            if (!res.headersSent) send(res, 500, 'Internal Server Error');
          }
        })();
      });
      const listening = new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolve(); }); });
      try { await listening; } catch (cause) { throw new CormiError('SERVE_FAILED', 'The server could not listen.', { host, port }, { cause }); }
      const address = server.address();
      if (!address || typeof address === 'string') { await new Promise<void>(resolve => server.close(() => resolve())); throw new CormiError('SERVE_FAILED', 'The server did not report a TCP address.'); }
      let closing: Promise<void> | undefined;
      return { kind: 'server' as const, handle: Object.freeze({
        url: `http://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}${base}`,
        close() { return closing ??= new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); },
      }) };
    }));
  },
};
