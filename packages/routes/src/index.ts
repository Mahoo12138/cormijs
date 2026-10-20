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
  /** Eager client component, independent of the page's lazy import; receives errors via useRouteError. */
  readonly errorBoundary?: ModuleRef;
  /** Internal absolute URL path rendered as a replace navigation; `:params` come from the matched route. */
  readonly redirect?: string;
  /** Append the current search and hash to a redirect target. */
  readonly keepQuery?: boolean;
  /** Opt a top-level route and its descendants out of the optional global layout. */
  readonly layout?: false;
  /** Public browser metadata, never server credentials or executable callbacks. */
  readonly meta?: RouteMeta;
  readonly source: { readonly file?: string; readonly pluginId?: string };
}
/** Application-facing nested route declaration, expanded to the flat RouteRecord IR. */
export interface ConfigRoute {
  readonly id?: string;
  readonly path?: string;
  readonly index?: boolean;
  /** Project-relative browser source file; its default export is the route component. */
  readonly component?: string;
  /** Project-relative browser source file exporting the route error boundary. */
  readonly errorBoundary?: string;
  /** Internal absolute URL path; a route with redirect cannot also define a page. */
  readonly redirect?: string;
  /** Keep the current query string and hash when redirecting. */
  readonly keepQuery?: boolean;
  /** Outer-to-inner layout components; each must render an Outlet for the route below it. */
  readonly wrappers?: readonly string[];
  /** Opt a top-level route and its descendants out of the optional global layout. */
  readonly layout?: false;
  readonly meta?: RouteMeta;
  readonly routes?: readonly ConfigRoute[];
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
function redirectTarget(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.length > 512 || /[\0\r\n\\]/.test(value)) {
    fail('ROUTE_REDIRECT_INVALID', 'Redirect must be an internal absolute URL path.');
  }
  return value;
}
function redirectParams(target: string, params: ReadonlySet<string>): void {
  const pathname = target.split(/[?#]/, 1)[0]!;
  for (const part of pathname.split('/')) {
    if (!part) continue;
    if (part.startsWith(':')) {
      if (!/^:[A-Za-z_][A-Za-z0-9_]*$/.test(part) || !params.has(part.slice(1))) {
        fail('ROUTE_REDIRECT_INVALID', `Redirect target references an unknown parameter: ${part}`, { param: part.slice(1) });
      }
    } else if (/[:*]/.test(part)) fail('ROUTE_REDIRECT_INVALID', 'Redirect target has an invalid path segment.', { part });
  }
}
function redirectKeepQuery(redirect: string | undefined, keepQuery: unknown): boolean {
  if (keepQuery !== undefined && typeof keepQuery !== 'boolean') fail('ROUTE_REDIRECT_INVALID', 'keepQuery must be boolean.');
  if (keepQuery === true && redirect === undefined) fail('ROUTE_REDIRECT_INVALID', 'keepQuery requires redirect.');
  if (keepQuery === true && redirect !== undefined && /[?#]/.test(redirect)) {
    fail('ROUTE_REDIRECT_INVALID', 'A keepQuery redirect cannot define its own query or hash.');
  }
  return keepQuery === true;
}

/** Validate and copy plugin/config output before it becomes executable application code. */
export function validateRoutes(input: unknown): readonly RouteRecord[] {
  if (!Array.isArray(input) || input.length > 10000) fail('ROUTE_INVALID', 'Expected at most 10000 routes.');
  const byId = new Map<string, RouteRecord>();
  const routes = input.map((item: unknown): RouteRecord => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('ROUTE_INVALID', 'Expected a route object.');
    const value = item as Record<string, unknown>;
    for (const key of Object.keys(value)) if (!['id', 'parentId', 'path', 'index', 'module', 'errorBoundary', 'redirect', 'keepQuery', 'layout', 'source', 'meta'].includes(key)) fail('ROUTE_INVALID', `Unknown route field: ${key}`);
    if (typeof value.id !== 'string' || !value.id || value.id.startsWith('cormi:') || byId.has(value.id)) fail('ROUTE_ID_CONFLICT', `Invalid, reserved or duplicate route id: ${value.id}`);
    if (value.parentId !== undefined && (typeof value.parentId !== 'string' || !value.parentId)) fail('ROUTE_INVALID', 'Invalid parent id.', { id: value.id });
    if (value.index !== undefined && typeof value.index !== 'boolean') fail('ROUTE_INVALID', 'index must be boolean.', { id: value.id });
    if (value.layout !== undefined && value.layout !== false) fail('ROUTE_LAYOUT_INVALID', 'layout only supports false.', { id: value.id });
    if (value.path !== undefined && typeof value.path !== 'string') fail('ROUTE_INVALID', 'path must be a string.', { id: value.id });
    if (value.index === true && value.path !== undefined) fail('ROUTE_INVALID', 'An index route cannot have a path.', { id: value.id });
    let path = value.path as string | undefined;
    if (path === '/' && value.parentId === undefined) path = '';
    if (path !== undefined && (path.startsWith('/') || path.endsWith('/') && path !== '' || /[?#%\\\0\r\n]/.test(path))) fail('ROUTE_PATH_INVALID', 'Route paths must be relative URL paths.', { id: value.id, path });
    for (const part of path ? path.split('/') : []) {
      if (!part || part === '.' || part === '..' || /[\[\]]/.test(part) || (part.includes(':') && !/^:[A-Za-z_][A-Za-z0-9_]*$/.test(part))
        || (part.includes('*') && part !== '*')) fail('ROUTE_PATH_INVALID', 'Unsupported route segment.', { id: value.id, part });
    }
    const redirect = value.redirect === undefined ? undefined : redirectTarget(value.redirect);
    const keepQuery = redirectKeepQuery(redirect, value.keepQuery);
    if (redirect !== undefined && (value.module !== undefined || value.errorBoundary !== undefined)) {
      fail('ROUTE_REDIRECT_INVALID', 'A redirect route cannot also define a module or error boundary.', { id: value.id });
    }
    if (redirect !== undefined && value.index !== true && value.path === undefined) {
      fail('ROUTE_REDIRECT_INVALID', 'A redirect route needs a path or index.', { id: value.id });
    }
    const rawSource = value.source ?? {};
    if (!rawSource || typeof rawSource !== 'object' || Array.isArray(rawSource)) fail('ROUTE_INVALID', 'Invalid source.');
    const source = rawSource as Record<string, unknown>;
    if (Object.keys(source).some(key => !['file', 'pluginId'].includes(key)) || Object.values(source).some(v => typeof v !== 'string')) fail('ROUTE_INVALID', 'Invalid route provenance.');
    const route: RouteRecord = Object.freeze({ id: value.id, ...(value.parentId !== undefined ? { parentId: value.parentId as string } : {}),
      ...(path !== undefined ? { path } : {}), ...(value.index === true ? { index: true } : {}),
      ...(value.module !== undefined ? { module: moduleRef(value.module) } : {}),
      ...(value.errorBoundary !== undefined ? { errorBoundary: moduleRef(value.errorBoundary) } : {}),
      ...(redirect !== undefined ? { redirect, ...(keepQuery ? { keepQuery: true } : {}) } : {}),
      ...(value.layout === false ? { layout: false as const } : {}),
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
    if (route.redirect !== undefined && nested) fail('ROUTE_REDIRECT_INVALID', 'Redirect routes cannot have children.', { id: route.id });
    const params = parts.filter(p => p.startsWith(':'));
    if (route.redirect !== undefined) redirectParams(route.redirect, new Set(params.map(part => part.slice(1))));
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

/** Wrap top-level routes in a pathless global layout; `layout: false` keeps a subtree outside it. */
export function applyGlobalLayout(routes: readonly RouteRecord[], layout: { readonly module: ModuleRef; readonly pluginId?: string; readonly id?: string }): readonly RouteRecord[] {
  if (!Array.isArray(routes) || !layout || typeof layout !== 'object' || Array.isArray(layout)) fail('ROUTE_LAYOUT_INVALID', 'Invalid global layout declaration.');
  const id = layout.id ?? 'layout:global';
  if (typeof id !== 'string' || !id || id.length > 256 || id.startsWith('cormi:')) fail('ROUTE_LAYOUT_INVALID', 'Invalid global layout route id.', { id });
  if (routes.some(route => route.id === id)) fail('ROUTE_ID_CONFLICT', `Global layout id conflicts with an existing route: ${id}`, { id });
  const module = moduleRef(layout.module);
  const wrapped = routes.some(route => !route.parentId && route.layout !== false);
  if (!wrapped) return validateRoutes(routes);
  const children = routes.map(route => !route.parentId && route.layout !== false ? Object.freeze({ ...route, parentId: id }) : route);
  const record: RouteRecord = Object.freeze({ id, module, source: Object.freeze({ ...(layout.pluginId ? { pluginId: layout.pluginId } : {}) }) });
  return validateRoutes([record, ...children]);
}

const configFields = new Set(['id', 'path', 'index', 'component', 'errorBoundary', 'redirect', 'keepQuery', 'wrappers', 'layout', 'meta', 'routes']);
function configId(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(value)) fail('ROUTE_CONFIG_INVALID', 'Invalid configured route id.', { id: value });
  return value;
}
function configModule(value: unknown, field: string): ModuleRef | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value || value.length > 512 || /[\0\r\n?#%\\]/.test(value) || isAbsolute(value)) fail('ROUTE_CONFIG_INVALID', `${field} must be a project-relative source file.`);
  const file = value.startsWith('./') ? value.slice(2) : value;
  const parts = file.split('/');
  if (!file || parts.some(part => !part || part === '.' || part === '..' || part.startsWith('.'))) fail('ROUTE_CONFIG_INVALID', `${field} must be a project-relative source file.`, { file: value });
  if (!/\.[cm]?[jt]sx?$/.test(file) || /\.d\.[cm]?[jt]sx?$/.test(file)) fail('ROUTE_CONFIG_INVALID', `${field} must be a runtime source file.`, { file: value });
  return moduleRef({ specifier: './' + file, exportName: 'default' });
}
/** Expand nested application routes into the validated flat IR; paths are relative to their parent. */
export function expandRouteConfig(input: unknown, options: { readonly pluginId?: string } = {}): readonly RouteRecord[] {
  if (!Array.isArray(input) || input.length > 10000) fail('ROUTE_CONFIG_INVALID', 'Expected at most 10000 configured routes.');
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'pluginId')) fail('ROUTE_CONFIG_INVALID', 'Invalid configured route options.');
  const pluginId = options.pluginId;
  if (pluginId !== undefined && (typeof pluginId !== 'string' || !pluginId || pluginId.length > 128)) fail('ROUTE_CONFIG_INVALID', 'Invalid configured route source id.');
  const records: RouteRecord[] = [], ids = new Set<string>();
  let total = 0;
  function visit(items: readonly unknown[], parentId: string | undefined, parentPath: string, depth: number): void {
    if (depth > 64) fail('ROUTE_CONFIG_INVALID', 'Configured route nesting exceeds depth 64.');
    for (const item of items) {
      if (++total > 10000) fail('ROUTE_CONFIG_INVALID', 'Configured routes exceed the 10000 route limit.');
      if (!item || typeof item !== 'object' || Array.isArray(item)) fail('ROUTE_CONFIG_INVALID', 'Expected a configured route object.');
      const row = item as Record<string, unknown>;
      for (const key of Object.keys(row)) if (!configFields.has(key)) fail('ROUTE_CONFIG_INVALID', `Unknown configured route field: ${key}`);
      const explicitId = configId(row.id);
      if (row.index !== undefined && typeof row.index !== 'boolean') fail('ROUTE_CONFIG_INVALID', 'index must be boolean.', { id: explicitId });
      if (row.path !== undefined && typeof row.path !== 'string') fail('ROUTE_CONFIG_INVALID', 'path must be a string.', { id: explicitId });
      if (row.routes !== undefined && (!Array.isArray(row.routes) || !row.routes.length)) fail('ROUTE_CONFIG_INVALID', 'Configured route children must be a non-empty array.', { id: explicitId });
      const children = (row.routes ?? []) as readonly unknown[], index = row.index === true;
      const component = configModule(row.component, 'component'), errorBoundary = configModule(row.errorBoundary, 'errorBoundary');
      const wrappers: ModuleRef[] = [];
      if (row.wrappers !== undefined) {
        if (!Array.isArray(row.wrappers) || !row.wrappers.length || row.wrappers.length > 32) {
          fail('ROUTE_CONFIG_INVALID', 'wrappers must be a non-empty array of at most 32 modules.', { id: explicitId });
        }
        for (let i = 0; i < row.wrappers.length; i++) wrappers.push(configModule(row.wrappers[i], `wrappers[${i}]`)!);
      }
      const redirect = row.redirect === undefined ? undefined : redirectTarget(row.redirect);
      const keepQuery = redirectKeepQuery(redirect, row.keepQuery);
      if (row.layout !== undefined && row.layout !== false) fail('ROUTE_CONFIG_INVALID', 'layout only supports false.', { id: explicitId });
      const noGlobalLayout = row.layout === false;
      let path = row.path as string | undefined;
      if (path !== undefined) {
        if (/[\0\r\n?#%\\]/.test(path) || path.length > 512) fail('ROUTE_PATH_INVALID', 'Invalid configured route path.', { id: explicitId, path });
        if (path === '/') { if (parentId !== undefined) fail('ROUTE_PATH_INVALID', 'Nested configured route paths must be relative.', { id: explicitId, path }); path = ''; }
        else if (path.startsWith('/')) {
          if (parentId !== undefined) fail('ROUTE_PATH_INVALID', 'Nested configured route paths must be relative.', { id: explicitId, path });
          if (path.startsWith('//')) fail('ROUTE_PATH_INVALID', 'Invalid configured route path.', { id: explicitId, path });
          path = path.slice(1);
        }
        if (path.endsWith('/')) fail('ROUTE_PATH_INVALID', 'Configured route paths cannot end with /.', { id: explicitId, path });
      }
      if (index && path !== undefined) fail('ROUTE_CONFIG_INVALID', 'An index route cannot have a path.', { id: explicitId });
      const hasChildren = children.length > 0;
      if (index && hasChildren) fail('ROUTE_CONFIG_INVALID', 'An index route cannot have children.', { id: explicitId });
      if (index && !component && redirect === undefined) fail('ROUTE_CONFIG_INVALID', 'An index route needs a component or redirect.', { id: explicitId });
      if (!index && path === undefined && !hasChildren) fail('ROUTE_CONFIG_INVALID', 'A configured route needs a path, index: true, children, or redirect.', { id: explicitId });
      if (!hasChildren && !component && redirect === undefined) fail('ROUTE_CONFIG_INVALID', 'A leaf configured route needs a component or redirect.', { id: explicitId });
      if (redirect !== undefined && (component || errorBoundary || hasChildren || wrappers.length)) {
        fail('ROUTE_REDIRECT_INVALID', 'A redirect route cannot also define a component, error boundary, children or wrappers.', { id: explicitId });
      }
      // An empty path is a pathless layout with children and an index route otherwise.
      const pathless = !index && (path === undefined || path === '') && hasChildren;
      const effectiveIndex = index || !hasChildren && path === '';
      const effectivePath = effectiveIndex ? undefined : path;
      if (wrappers.length && effectivePath !== undefined && effectivePath.split('/').includes('*')) {
        fail('ROUTE_CONFIG_INVALID', 'wrappers cannot wrap a catch-all route.', { id: explicitId });
      }
      const full = [parentPath, effectivePath].filter((part): part is string => !!part).join('/'), base = `config:${full || 'root'}`;
      const id = explicitId ?? (effectiveIndex ? `${base}:index` : pathless ? `${base}:layout` : base);
      if (id.length > 256) fail('ROUTE_CONFIG_INVALID', 'Configured route id is too long; set an explicit id.', { id });
      if (ids.has(id)) fail('ROUTE_ID_CONFLICT', `Duplicate configured route id: ${id}`, { id });
      ids.add(id);
      if (redirect !== undefined) redirectParams(redirect, new Set(full.split('/').filter(part => part.startsWith(':')).map(part => part.slice(1))));
      const source = Object.freeze({ ...(pluginId ? { pluginId } : {}) });
      let recordParent = parentId, recordPath = effectivePath;
      for (let i = 0; i < wrappers.length; i++) {
        const wrapperId = `${id}:wrapper:${i + 1}`;
        if (wrapperId.length > 256) fail('ROUTE_CONFIG_INVALID', 'Configured route wrapper id is too long; shorten the explicit id.', { id: wrapperId });
        if (ids.has(wrapperId)) fail('ROUTE_ID_CONFLICT', `Duplicate configured route id: ${wrapperId}`, { id: wrapperId });
        ids.add(wrapperId);
        records.push(Object.freeze({ id: wrapperId, ...(recordParent !== undefined ? { parentId: recordParent } : {}),
          ...(recordPath !== undefined ? { path: recordPath } : {}), module: wrappers[i]!, ...(noGlobalLayout ? { layout: false as const } : {}), source }));
        recordParent = wrapperId; recordPath = '';
      }
      records.push(Object.freeze({ id, ...(recordParent !== undefined ? { parentId: recordParent } : {}),
        ...(effectiveIndex ? { index: true } : recordPath !== undefined ? { path: recordPath } : {}),
        ...(component ? { module: component } : {}), ...(errorBoundary ? { errorBoundary } : {}),
        ...(redirect !== undefined ? { redirect, ...(keepQuery ? { keepQuery: true } : {}) } : {}),
        ...(noGlobalLayout ? { layout: false as const } : {}),
        ...(row.meta !== undefined ? { meta: row.meta as RouteMeta } : {}), source }));
      if (hasChildren) visit(children, id, full, depth + 1);
    }
  }
  visit(input, undefined, '', 0);
  return validateRoutes(records);
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
