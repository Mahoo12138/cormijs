import { CormiError, type Plugin } from '@cormijs/core';
import { build as esbuild } from 'esbuild';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ViteDevServer } from 'vite';
import type {} from '@cormijs/plugin-vite';

export interface ApiRoutePluginOptions {
  readonly id?: string;
  /** Project-relative source directory; default `src/api`. */
  readonly directory?: string;
  /** Absolute URL prefix owned by the plugin; default `/api`. */
  readonly prefix?: string;
}
export interface ApiRoute {
  /** Public URL path, without a trailing slash (`/api`, `/api/users`). */
  readonly path: string;
  /** Project-relative source file with forward slashes. */
  readonly file: string;
  readonly params: readonly string[];
}
export interface ApiHandlerContext {
  readonly params: Readonly<Record<string, string>>;
}
export type ApiHandler = (request: Request, context: ApiHandlerContext) => Response | Promise<Response>;
interface ApiManifest { readonly format: 'cormi:api:1'; readonly routes: readonly (ApiRoute & { readonly handler: string })[] }

const extensions = new Set(['.ts', '.tsx', '.js', '.mjs']);
const maxFiles = 128, maxSource = 512 * 1024, maxRequest = 1024 * 1024, maxResponse = 8 * 1024 * 1024;
const paramPattern = /^[A-Za-z_][A-Za-z0-9_]*$/;
const segmentPattern = /^[A-Za-z0-9._~-]+$/;
const toPosix = (value: string) => value.split(sep).join('/');

function normalizeOptions(options: ApiRoutePluginOptions = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'directory', 'prefix'].includes(key))) {
    throw new CormiError('API_INVALID', 'Invalid API route plugin options.');
  }
  const id = options.id ?? 'cormi:api';
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('API_INVALID', 'Invalid API route plugin id.');
  const directory = options.directory ?? 'src/api';
  const normalized = directory.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!normalized || isAbsolute(directory) || normalized.split('/').some(part => !part || part === '..' || part === 'node_modules' || part === '.cormi')
    || normalized.includes('//')) {
    throw new CormiError('API_INVALID', 'API directory must be a project-relative path.', { directory });
  }
  if (normalized.length > 256) throw new CormiError('API_INVALID', 'API directory is too long.');
  const prefix = options.prefix ?? '/api';
  if (typeof prefix !== 'string' || prefix === '/' || prefix.length > 64 || !prefix.startsWith('/') || prefix.endsWith('/')
    || prefix.startsWith('//') || prefix.includes('?') || prefix.includes('#') || prefix.includes('\\') || prefix.split('/').includes('..')
    || !/^\/[A-Za-z0-9._~:/-]+$/.test(prefix)) {
    throw new CormiError('API_INVALID', 'API prefix must be a bounded absolute URL path other than /.', { prefix });
  }
  return { id, directory: normalized, prefix };
}

/** Map source files to URL patterns; index files address their directory and `[name]` captures one segment. */
export function resolveApiRoutes(files: readonly string[], directory = 'src/api', prefix = '/api'): readonly ApiRoute[] {
  const base = directory.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  const head = prefix.replace(/\/+$/, '');
  const routes: ApiRoute[] = [], shapes = new Map<string, string>();
  for (const input of files) {
    const file = toPosix(input).replace(/^\.\//, '');
    if (!file.startsWith(base + '/')) continue;
    const rest = file.slice(base.length + 1);
    const slash = rest.lastIndexOf('/');
    const name = slash < 0 ? rest : rest.slice(slash + 1);
    const dot = name.lastIndexOf('.');
    const extension = dot < 0 ? '' : name.slice(dot).toLowerCase();
    if (!extensions.has(extension) || name.includes('.d.')) continue;
    if (name.startsWith('_') || /\.(?:test|spec)\.[^.]+$/.test(name)) continue;
    const stem = dot < 0 ? rest : rest.slice(0, rest.length - name.length + dot);
    const parts = stem.split('/');
    if (parts[parts.length - 1] === 'index') parts.pop();
    if (parts.some(part => !part || part.startsWith('_') || part === 'node_modules')) continue;
    const params: string[] = [], shape: string[] = [];
    let invalid = false;
    for (const part of parts) {
      const dynamic = /^\[([^\]]+)\]$/.exec(part);
      if (dynamic) {
        const param = dynamic[1]!;
        if (!paramPattern.test(param) || params.includes(param)) { invalid = true; break; }
        params.push(param); shape.push(':');
      } else if (!segmentPattern.test(part)) { invalid = true; break; } else shape.push(part);
    }
    if (invalid) throw new CormiError('API_ROUTE_INVALID', 'API route segments must be literals or [param].', { file });
    const path = parts.length ? `${head}/${parts.join('/')}`.replace(/\[([^\]]+)\]/g, ':$1') : head;
    const key = `${head}/${shape.join('/')}`;
    const owner = shapes.get(key);
    if (owner !== undefined) throw new CormiError('API_ROUTE_CONFLICT', 'API routes resolve to the same URL shape.', { file, owner, key });
    shapes.set(key, file);
    routes.push(Object.freeze({ path, file, params: Object.freeze(params) }));
  }
  return Object.freeze(routes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)));
}

/** Match a decoded URL path against the route table; static segments win over `[param]` captures. */
export function matchApiRoute(routes: readonly ApiRoute[], pathname: string): { route: ApiRoute; params: Readonly<Record<string, string>> } | undefined {
  let matched: { route: ApiRoute; params: Record<string, string>; staticFlags: boolean[] } | undefined;
  for (const route of routes) {
    const expected = route.path.split('/').filter(Boolean), actual = pathname.split('/').filter(Boolean);
    if (expected.length !== actual.length) continue;
    const params: Record<string, string> = {}, staticFlags: boolean[] = []; let ok = true;
    for (let index = 0; index < expected.length; index++) {
      const want = expected[index]!, value = actual[index]!;
      let decoded: string;
      try { decoded = decodeURIComponent(value); } catch { ok = false; break; }
      if (decoded.includes('/') || decoded.includes('\0')) { ok = false; break; }
      if (want.startsWith(':')) { params[want.slice(1)] = decoded; staticFlags.push(false); }
      else if (want === decoded) staticFlags.push(true);
      else { ok = false; break; }
    }
    if (!ok) continue;
    if (matched) {
      let better = false;
      for (let index = 0; index < staticFlags.length; index++) {
        if (staticFlags[index] === matched.staticFlags[index]) continue;
        better = staticFlags[index]!; break;
      }
      if (!better) continue;
    }
    matched = { route, params, staticFlags };
  }
  return matched ? { route: matched.route, params: Object.freeze(matched.params) } : undefined;
}

async function sourceFiles(root: string, directory: string): Promise<readonly string[]> {
  const files: string[] = [];
  const walk = async (absolute: string, depth: number): Promise<void> => {
    if (depth > 16 || files.length > maxFiles) return;
    const entries = await readdir(absolute, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const target = join(absolute, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(target, depth + 1);
      else if (entry.isFile() && files.length < maxFiles) files.push(toPosix(relative(root, target)));
    }
  };
  await walk(join(root, directory), 0);
  return Object.freeze(files.sort());
}

function send(res: ServerResponse, status: number, body: string, type = 'application/json; charset=utf-8') {
  if (res.headersSent) return;
  res.statusCode = status; res.setHeader('content-type', type); res.setHeader('content-length', Buffer.byteLength(body)); res.end(body);
}
const fail = (res: ServerResponse, status: number, code: string) => send(res, status, JSON.stringify({ error: code }));

async function readBody(request: IncomingMessage): Promise<Buffer | undefined> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined;
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > maxRequest) throw new CormiError('API_REQUEST_TOO_LARGE', 'API request body exceeds 1 MiB.');
    chunks.push(buffer);
  }
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

function toRequest(request: IncomingMessage, body: Buffer | undefined, signal: AbortSignal): Request {
  const origin = `http://${typeof request.headers.host === 'string' ? request.headers.host : 'localhost'}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined || name === 'content-length' || name === 'transfer-encoding') continue;
    if (Array.isArray(value)) for (const item of value) headers.append(name, item);
    else headers.set(name, value);
  }
  const init: RequestInit & { duplex?: 'half' } = { method: request.method ?? 'GET', headers, signal };
  if (body) { init.body = new Uint8Array(body); init.duplex = 'half'; }
  return new Request(new URL(request.url ?? '/', origin), init);
}

async function writeResponse(response: Response, res: ServerResponse, head: boolean): Promise<void> {
  if (!(response instanceof Response)) throw new CormiError('API_HANDLER_INVALID', 'API handler must return a Response.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxResponse) throw new CormiError('API_RESPONSE_TOO_LARGE', 'API response exceeds 8 MiB.');
  res.statusCode = response.status;
  for (const [name, value] of response.headers) res.setHeader(name, value);
  const cookies = response.headers.getSetCookie?.() ?? [];
  if (cookies.length) res.setHeader('set-cookie', cookies);
  res.setHeader('content-length', bytes.byteLength);
  res.end(head ? undefined : bytes);
}

/** Shared bridge: one Fetch request in, one buffered Fetch response out, failures never leak stacks. */
export async function runApiHandler(handler: ApiHandler, request: IncomingMessage, res: ServerResponse, params: Readonly<Record<string, string>>): Promise<void> {
  const controller = new AbortController();
  res.once('close', () => controller.abort());
  try {
    const body = await readBody(request);
    const response = await handler(toRequest(request, body, controller.signal), { params });
    await writeResponse(response, res, request.method === 'HEAD');
  } catch (error) {
    if (controller.signal.aborted) return;
    if (error instanceof CormiError && (error.code === 'API_REQUEST_TOO_LARGE' || error.code === 'API_RESPONSE_TOO_LARGE')) return fail(res, error.code === 'API_REQUEST_TOO_LARGE' ? 413 : 500, error.code);
    console.error('[cormi:api]', error);
    if (!res.headersSent) fail(res, 500, 'API_HANDLER_FAILED');
  }
}

async function readManifest(output: string): Promise<ApiManifest> {
  const file = join(output, '.cormi', 'api', 'manifest.json');
  const text = await readFile(file, 'utf8').catch((error: NodeJS.ErrnoException) => {
    throw error.code === 'ENOENT' ? new CormiError('API_MANIFEST_MISSING', 'No API manifest in the build output; build with apiRoutePlugin enabled.', { output }) : error;
  });
  let parsed: unknown;
  try { parsed = JSON.parse(text); } catch { throw new CormiError('API_MANIFEST_INVALID', 'API manifest is not valid JSON.', { file }); }
  if (!parsed || typeof parsed !== 'object' || (parsed as ApiManifest).format !== 'cormi:api:1' || !Array.isArray((parsed as ApiManifest).routes)) {
    throw new CormiError('API_MANIFEST_INVALID', 'API manifest has an unsupported shape.', { file });
  }
  for (const route of (parsed as ApiManifest).routes) {
    if (!route || typeof route.path !== 'string' || typeof route.file !== 'string' || typeof route.handler !== 'string'
      || !Array.isArray(route.params) || route.params.some(param => typeof param !== 'string')) throw new CormiError('API_MANIFEST_INVALID', 'API manifest route is malformed.', { file });
  }
  return parsed as ApiManifest;
}

/** Opt-in server route plugin: `src/api/**` handlers run in dev and from compiled output in preview. */
export const apiRoutePlugin: Plugin.Object<ApiRoutePluginOptions> = {
  name: 'cormi:api', inject: ['vite'],
  apply(ctx, options) {
    const { id, directory, prefix } = normalizeOptions(options);
    const owns = (pathname: string) => pathname === prefix || pathname.startsWith(prefix + '/');
    ctx.effect(() => ctx.vite.add(id, () => {
      let sourceRoot = '', output = ''; let building = false;
      let dev: ViteDevServer | undefined;
      let routes: readonly ApiRoute[] = [];
      let manifest: ApiManifest = { format: 'cormi:api:1', routes: [] };
      const compiled = new Map<string, ApiHandler>();

      const devHandler = async (route: ApiRoute): Promise<ApiHandler> => {
        if (!dev) throw new CormiError('API_UNAVAILABLE', 'API dev server is not ready.');
        const module = await dev.ssrLoadModule('/' + route.file) as { default?: unknown };
        if (typeof module.default !== 'function') throw new CormiError('API_HANDLER_INVALID', 'API module must default-export a handler.', { file: route.file });
        return module.default as ApiHandler;
      };
      const previewHandler = async (route: ApiRoute & { handler: string }): Promise<ApiHandler> => {
        const cached = compiled.get(route.path);
        if (cached) return cached;
        const file = join(output, route.handler);
        const local = relative(output, file);
        if (!local || isAbsolute(local) || local.startsWith('..' + sep)) throw new CormiError('API_MANIFEST_INVALID', 'API handler escapes the output directory.', { handler: route.handler });
        const module = await import(pathToFileURL(file).href) as { default?: unknown };
        if (typeof module.default !== 'function') throw new CormiError('API_HANDLER_INVALID', 'Compiled API module has no default handler.', { file: route.handler });
        compiled.set(route.path, module.default as ApiHandler); return module.default as ApiHandler;
      };
      const dispatch = async (request: IncomingMessage, res: ServerResponse, next: (error?: unknown) => void, mode: 'dev' | 'preview') => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
        if (mode === 'preview' && pathname.startsWith('/.cormi/')) return fail(res, 404, 'API_ROUTE_NOT_FOUND');
        if (!owns(pathname)) return next();
        const match = matchApiRoute(routes, pathname);
        if (!match) return fail(res, 404, 'API_ROUTE_NOT_FOUND');
        try {
          const handler = mode === 'dev' ? await devHandler(match.route) : await previewHandler(match.route as ApiRoute & { handler: string });
          await runApiHandler(handler, request, res, match.params);
        } catch (error) {
          console.error('[cormi:api]', error);
          if (!res.headersSent) fail(res, 500, error instanceof CormiError ? error.code : 'API_HANDLER_FAILED');
        }
      };

      return {
        name: id,
        configResolved(config) { sourceRoot = config.root; output = config.build.outDir; building = config.command === 'build'; },
        async configureServer(server) {
          dev = server;
          routes = resolveApiRoutes(await sourceFiles(server.config.root, directory), directory, prefix);
          server.middlewares.use((request, response, next) => { void dispatch(request, response, next, 'dev'); });
        },
        async configurePreviewServer(server) {
          manifest = await readManifest(server.config.build.outDir);
          routes = manifest.routes.map(route => Object.freeze({ ...route, params: Object.freeze([...route.params]) }));
          server.middlewares.use((request, response, next) => { void dispatch(request, response, next, 'preview'); });
        },
        async closeBundle() {
          // Vite also runs closeBundle when a dev/preview session closes; only a real build owns dist.
          if (!building || !output) return;
          const files = await sourceFiles(sourceRoot, directory);
          const found = resolveApiRoutes(files, directory, prefix);
          const target = join(output, '.cormi', 'api');
          await mkdir(join(target, 'handlers'), { recursive: true });
          const emitted: (ApiRoute & { handler: string })[] = [];
          for (const [index, route] of found.entries()) {
            const handler = `.cormi/api/handlers/${index}.mjs`;
            try {
              await esbuild({
                entryPoints: [join(sourceRoot, route.file)], outfile: join(output, handler), bundle: true, platform: 'node',
                format: 'esm', target: 'node22', packages: 'external', absWorkingDir: sourceRoot, logLevel: 'silent',
              });
            } catch (cause) {
              throw new CormiError('API_BUILD_FAILED', 'API handler failed to compile.', { file: route.file }, { cause });
            }
            emitted.push(Object.freeze({ ...route, handler }));
          }
          const value: ApiManifest = { format: 'cormi:api:1', routes: emitted };
          await writeFile(join(target, 'manifest.json'), `${JSON.stringify(value, null, 2)}\n`);
          manifest = value;
        },
      };
    }));
  },
};
