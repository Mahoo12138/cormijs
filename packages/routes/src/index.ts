import { CormiError } from '@cormijs/core';
import { lstat, readdir, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeMeta, type RouteMeta } from './json.js';
export { jsonData, routeMeta, type JsonValue, type RouteMeta } from './json.js';

export interface ModuleRef {
  readonly specifier: string;
  readonly exportName: string;
  /** Explicit Node author-module URL. Relative references are confined to its directory. */
  readonly from?: string;
}
export interface RouteRecord {
  readonly id: string;
  readonly parentId?: string;
  /** Relative to the parent; the empty string is the root path. */
  readonly path?: string;
  readonly index?: boolean;
  readonly module?: ModuleRef;
  /** Public browser metadata, never server credentials or executable callbacks. */
  readonly meta?: RouteMeta;
  readonly source: { readonly file?: string; readonly pluginId?: string };
}
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const slash = (path: string) => path.split(sep).join('/');
function fail(code: string, message: string, details: Record<string, unknown> = {}): never { throw new CormiError(code, message, details); }
export function projectPath(root: string, file: string): string {
  if (isAbsolute(file) || file.includes('\\') || file.includes('\0')) fail('ROUTE_PATH_INVALID', 'Expected a project-relative path.', { file });
  const path = resolve(root, file), rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) fail('ROUTE_PATH_INVALID', 'Path escapes the project.', { file });
  return path;
}
export function moduleRef(value: unknown): ModuleRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('ROUTE_MODULE_INVALID', 'Expected a module reference.');
  const ref = value as Record<string, unknown>;
  if (Object.keys(ref).some(key => !['specifier', 'exportName', 'from'].includes(key)) || typeof ref.specifier !== 'string' || !ref.specifier
    || typeof ref.exportName !== 'string' || !ref.exportName || /[\0\r\n?#%\\]/.test(ref.specifier)
    || ref.specifier.startsWith('/') || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(ref.specifier)) fail('ROUTE_MODULE_INVALID', 'Invalid module reference.');
  if (ref.from !== undefined) {
    try {
      if (typeof ref.from !== 'string' || !ref.specifier.startsWith('./')) throw new Error('Only local relative modules can specify from.');
      const url = new URL(ref.from);
      if (url.protocol !== 'file:' || url.search || url.hash || url.username || url.password || url.pathname.endsWith('/')) throw new Error('Expected a file module URL.');
      fileURLToPath(url);
    } catch { fail('ROUTE_MODULE_INVALID', 'from must be an absolute file module URL paired with a ./ reference.'); }
  }
  return Object.freeze({ specifier: ref.specifier, exportName: ref.exportName, ...(ref.from !== undefined ? { from: ref.from as string } : {}) });
}

/** Validate and copy plugin/config output before it becomes executable application code. */
export function validateRoutes(input: unknown): readonly RouteRecord[] {
  if (!Array.isArray(input) || input.length > 10000) fail('ROUTE_INVALID', 'Expected at most 10000 routes.');
  const byId = new Map<string, RouteRecord>();
  const routes = input.map((item: unknown): RouteRecord => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('ROUTE_INVALID', 'Expected a route object.');
    const value = item as Record<string, unknown>;
    for (const key of Object.keys(value)) if (!['id', 'parentId', 'path', 'index', 'module', 'source', 'meta'].includes(key)) fail('ROUTE_INVALID', `Unknown route field: ${key}`);
    if (typeof value.id !== 'string' || !value.id || value.id.startsWith('cormi:') || byId.has(value.id)) fail('ROUTE_ID_CONFLICT', `Invalid, reserved or duplicate route id: ${value.id}`);
    if (value.parentId !== undefined && (typeof value.parentId !== 'string' || !value.parentId)) fail('ROUTE_INVALID', 'Invalid parent id.', { id: value.id });
    if (value.index !== undefined && typeof value.index !== 'boolean') fail('ROUTE_INVALID', 'index must be boolean.', { id: value.id });
    if (value.path !== undefined && typeof value.path !== 'string') fail('ROUTE_INVALID', 'path must be a string.', { id: value.id });
    if (value.index === true && value.path !== undefined) fail('ROUTE_INVALID', 'An index route cannot have a path.', { id: value.id });
    let path = value.path as string | undefined;
    if (path === '/' && value.parentId === undefined) path = '';
    if (path !== undefined && (path.startsWith('/') || path.endsWith('/') && path !== '' || /[?#%\\\0\r\n]/.test(path))) fail('ROUTE_PATH_INVALID', 'Route paths must be relative URL paths.', { id: value.id, path });
    for (const part of path ? path.split('/') : []) {
      if (!part || part === '.' || part === '..' || /[\[\]]/.test(part) || (part.includes(':') && !/^:[A-Za-z_][A-Za-z0-9_]*$/.test(part))
        || (part.includes('*') && part !== '*')) fail('ROUTE_PATH_INVALID', 'Unsupported route segment.', { id: value.id, part });
    }
    const rawSource = value.source ?? {};
    if (!rawSource || typeof rawSource !== 'object' || Array.isArray(rawSource)) fail('ROUTE_INVALID', 'Invalid source.');
    const source = rawSource as Record<string, unknown>;
    if (Object.keys(source).some(key => !['file', 'pluginId'].includes(key)) || Object.values(source).some(v => typeof v !== 'string')) fail('ROUTE_INVALID', 'Invalid route provenance.');
    const route: RouteRecord = Object.freeze({ id: value.id, ...(value.parentId !== undefined ? { parentId: value.parentId as string } : {}),
      ...(path !== undefined ? { path } : {}), ...(value.index === true ? { index: true } : {}),
      ...(value.module !== undefined ? { module: moduleRef(value.module) } : {}),
      ...(value.meta !== undefined ? { meta: routeMeta(value.meta) } : {}), source: Object.freeze({ ...source }) });
    byId.set(route.id, route); return route;
  });
  const children = new Map<string, RouteRecord[]>();
  for (const route of routes) {
    if (!route.parentId) continue;
    if (!byId.has(route.parentId)) fail('ROUTE_PARENT_MISSING', 'Route parent does not exist.', { id: route.id, parentId: route.parentId });
    const list = children.get(route.parentId) ?? []; list.push(route); children.set(route.parentId, list);
  }
  const full = new Map<string, string>();
  function fullPath(route: RouteRecord, visiting = new Set<string>()): string {
    if (full.has(route.id)) return full.get(route.id)!;
    if (visiting.has(route.id) || visiting.size > 128) fail('ROUTE_PARENT_CYCLE', 'Route parents contain a cycle or exceed depth 128.', { ids: [...visiting, route.id] });
    visiting.add(route.id);
    const parent = route.parentId ? fullPath(byId.get(route.parentId)!, visiting) : '';
    visiting.delete(route.id);
    const path = [parent, route.path].filter(Boolean).join('/'); full.set(route.id, path); return path;
  }
  const endpoints = new Map<string, RouteRecord>();
  for (const route of routes) {
    const path = fullPath(route), parts = path ? path.split('/') : [], nested = children.get(route.id)?.length ?? 0;
    if (route.index && nested) fail('ROUTE_INVALID', 'Index route cannot have children.', { id: route.id });
    if (parts.includes('*') && (parts.at(-1) !== '*' || parts.filter(p => p === '*').length !== 1 || nested)) fail('ROUTE_PATH_INVALID', 'Catch-all must be terminal.', { id: route.id });
    const params = parts.filter(p => p.startsWith(':'));
    if (new Set(params).size !== params.length) fail('ROUTE_PATH_INVALID', 'Repeated parameter in one path.', { id: route.id });
    // Layout/container endpoints may share their path with their index child, but page endpoints may not.
    if (nested && !route.index) continue;
    const shape = parts.map(part => part.startsWith(':') ? ':' : part.normalize('NFC').toLowerCase()).join('/');
    const other = endpoints.get(shape);
    if (other) fail('ROUTE_CONFLICT', `Ambiguous routes: ${other.id} and ${route.id}`, { path, first: other.source, second: route.source });
    endpoints.set(shape, route);
  }
  return Object.freeze(routes);
}

function routeSegment(part: string): string {
  const rest = /^\[\.\.\.([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(part);
  if (rest) return '*';
  const param = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(part);
  if (param) return ':' + param[1];
  if (/[\[\]:*?#%\\]/.test(part)) fail('ROUTE_PATH_INVALID', 'Unsupported page filename.', { part });
  return part;
}

/** Returns project-relative page names only. Never imports/evaluates a page module. */
export async function pageFiles(root: string, directory = 'src/pages'): Promise<readonly string[]> {
  root = await realpath(root);
  const base = projectPath(root, directory);
  if (directory.split(/[\\/]/).some(p => p.startsWith('.') || ['node_modules', 'public'].includes(p))) fail('ROUTE_PATH_INVALID', 'Invalid pages directory.');
  const files: string[] = [];
  async function visit(path: string, depth: number): Promise<void> {
    if (depth > 64 || files.length > 10000) fail('ROUTE_LIMIT', 'Page tree exceeds the supported limit.');
    let info;
    try { info = await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
    if (info.isSymbolicLink()) fail('ROUTE_SYMLINK', 'Page trees cannot contain symlinks.', { file: slash(relative(root, path)) });
    if (info.isDirectory()) {
      if (await realpath(path) !== path) fail('ROUTE_SYMLINK', 'Page tree ancestor is a symlink.', { path });
      for (const name of (await readdir(path)).sort(compare)) {
        if (name.startsWith('.') || name.startsWith('_') && !/^_layout\.(tsx|jsx)$/.test(name) || /\.(test|spec)\./.test(name)) continue;
        await visit(join(path, name), depth + 1);
      }
    } else if (info.isFile() && /\.(tsx|jsx)$/.test(path)) files.push(slash(relative(root, path)));
  }
  await visit(base, 0); return Object.freeze(files.sort(compare));
}
export function routesFromFiles(files: readonly string[], directory = 'src/pages'): readonly RouteRecord[] {
  const prefix = directory.replace(/\/$/, '') + '/';
  const descriptors = [...files].sort(compare).map(file => {
    if (!file.startsWith(prefix) || file.includes('\\')) fail('ROUTE_PATH_INVALID', 'File outside the pages directory.', { file });
    const local = file.slice(prefix.length).replace(/\.(tsx|jsx)$/, '');
    const parts = local.split('/'), name = parts.pop()!;
    const layout = name === '_layout', index = name === 'index';
    const dir = parts.join('/');
    const segments = [...parts, ...(layout || index ? [] : [name])].map(routeSegment);
    return { file, dir, layout, index, segments, id: `file:${file}` };
  });
  const layouts = new Map<string, typeof descriptors[number]>();
  for (const item of descriptors) if (item.layout) {
    if (layouts.has(item.dir)) fail('ROUTE_CONFLICT', 'Multiple layouts in one directory.', { directory: item.dir });
    layouts.set(item.dir, item);
  }
  return validateRoutes(descriptors.map(item => {
    let at: string | undefined = item.layout ? (item.dir ? posix.dirname(item.dir) : undefined) : item.dir;
    if (at === '.') at = '';
    let parent: typeof item | undefined;
    while (at !== undefined) {
      parent = layouts.get(at); if (parent) break;
      at = at ? posix.dirname(at) : undefined; if (at === '.') at = '';
    }
    const remaining = item.segments.slice(parent?.segments.length ?? 0).join('/');
    return { id: item.id, ...(parent ? { parentId: parent.id } : {}),
      ...(item.index && !remaining ? { index: true } : { path: remaining }),
      module: { specifier: './' + item.file, exportName: 'default' }, source: { file: item.file } };
  }));
}
export async function scanPages(root: string, directory = 'src/pages'): Promise<readonly RouteRecord[]> {
  return routesFromFiles(await pageFiles(root, directory), directory);
}
