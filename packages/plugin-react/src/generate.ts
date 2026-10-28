import { CormiError, type RuntimePluginDescriptor } from '@cormijs/core';
import { moduleRef, jsonData, validateRoutes, type ModuleRef, type RouteRecord } from '@cormijs/routes';
import { isAbsolute, join, relative, sep } from 'node:path';
import { clientSpecifier } from './modules.js';
import type { AppRuntimePlan } from './app-runtime.js';
import type { ModelPlan } from './model.js';
import type { GlobalStylePlan } from './global-style.js';
import type { LocaleCatalog } from './locale.js';
export { isServerModule } from './modules.js';

// Legacy alias for backward compatibility during migration
export interface RuntimeContribution { readonly id: string; readonly module: ModuleRef; readonly options?: unknown }
export type HistoryType = 'browser' | 'hash' | 'memory';

/**
 * Validate and normalize runtime plugin descriptors into RuntimeContribution (ModuleRef-based).
 * Accepts both new RuntimePluginDescriptor format and legacy RuntimeContribution format.
 * The internal pipeline always works with ModuleRef; RuntimePluginDescriptor is the public
 * authoring type that gets converted here.
 */
export function runtimeContributions(input: unknown): readonly RuntimeContribution[] {
  if (!Array.isArray(input) || input.length > 256) throw new CormiError('RUNTIME_INVALID', 'Expected at most 256 runtime modules.');
  const ids = new Set<string>();
  return Object.freeze(input.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CormiError('RUNTIME_INVALID', 'Expected a runtime contribution.');
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some(key => !['id', 'module', 'options'].includes(key)) || typeof item.id !== 'string' || !item.id || ids.has(item.id))
      throw new CormiError('RUNTIME_ID_CONFLICT', 'Invalid or duplicate runtime id.');
    ids.add(item.id);

    const mod = item.module;
    let moduleRefValue: ModuleRef;

    if (typeof mod === 'string') {
      // Plain string: treat as specifier with default export
      moduleRefValue = moduleRef({ specifier: mod, exportName: 'default' });
    } else if (mod && typeof mod === 'object' && !Array.isArray(mod)) {
      const m = mod as Record<string, unknown>;
      if (typeof m.specifier === 'string' && typeof m.exportName === 'string') {
        // Legacy RuntimeContribution format: { specifier, exportName }
        moduleRefValue = moduleRef({ specifier: m.specifier, exportName: m.exportName });
      } else if (typeof m.package === 'string') {
        // New RuntimePluginDescriptor format: { package, export? }
        moduleRefValue = moduleRef({ specifier: m.package, exportName: (m.export as string) ?? 'default' });
      } else if (typeof m.file === 'string') {
        // New RuntimePluginDescriptor format: { file }
        moduleRefValue = moduleRef({ specifier: m.file, exportName: 'default' });
      } else {
        throw new CormiError('RUNTIME_INVALID', 'Invalid runtime module reference.');
      }
    } else {
      throw new CormiError('RUNTIME_INVALID', 'Invalid runtime module reference.');
    }

    return Object.freeze({ id: item.id, module: moduleRefValue, options: jsonData(item.options ?? {}, 'RUNTIME_OPTIONS_INVALID') });
  }));
}
/** Stylesheets are side-effect imports resolved relative to `.cormi/`; the specifier stays project-local. */
function styleSpecifier(root: string, file: string): string {
  const target = join(root, file), inside = relative(root, target);
  if (!inside || isAbsolute(inside) || inside === '..' || inside.startsWith('..' + sep)
    || /(?:^|[\/])(?:node_modules|\.cormi[^\/]*|\.env(?:\.|$))/.test(target)) throw new CormiError('STYLE_INVALID', 'Global style file must stay in project sources.', { file });
  const local = relative(join(root, '.cormi'), target).split(sep).join('/');
  if (isAbsolute(local)) throw new CormiError('STYLE_INVALID', 'Cross-volume style files are not supported.', { file });
  return local;
}

/** Static imports and JSON string literals only; no user-provided expression interpolation. */
export async function generateApplication(root: string, routes: readonly RouteRecord[], runtimes: readonly RuntimeContribution[],
  base: string, mountId: string, serverOnlyFiles: readonly string[] = [], strict = false, appRuntime?: AppRuntimePlan, loading?: ModuleRef,
  history: HistoryType = 'browser', models: readonly ModelPlan[] = [], styles: readonly GlobalStylePlan[] = [], access?: ModuleRef, localeCatalogs: readonly LocaleCatalog[] = []): Promise<string> {
  if (typeof strict !== 'boolean') throw new CormiError('CONFIG_INVALID', 'strict must be boolean.');
  routes = validateRoutes(routes); runtimes = runtimeContributions(runtimes);
  const forbidden = new Set(serverOnlyFiles);
  const appModule = appRuntime?.module ? await clientSpecifier(root, appRuntime.module, forbidden) : undefined;
  const appValue = appRuntime?.module?.exportName === '*' ? 'applicationConfig' : `{default:applicationConfig[${JSON.stringify(appRuntime?.module?.exportName)}]}`;

  const loadingModule = loading ? await clientSpecifier(root, loading, forbidden) : undefined;
  const loadingOption = loadingModule ? `,loading:applicationLoading[${JSON.stringify(loading!.exportName)}]` : '';
  const historyOption = history === 'browser' ? '' : `,history:${JSON.stringify(history)} as const`;
  const routeModules = new Map<string, string>();
  await Promise.all(routes.map(async route => { if (route.module) routeModules.set(route.id, await clientSpecifier(root, route.module, forbidden)); }));
  const runtimeModules = await Promise.all(runtimes.map(item => clientSpecifier(root, item.module, forbidden)));
  const modelModules = await Promise.all(models.map(model => clientSpecifier(root, model.module, forbidden)));
  const boundaryPaths = await Promise.all(routes.map(route => route.errorBoundary ? clientSpecifier(root, route.errorBoundary, forbidden) : undefined));
  const boundaryImports = new Map<string, string>();
  for (const path of boundaryPaths) if (path && !boundaryImports.has(path)) boundaryImports.set(path, `boundary${boundaryImports.size}`);
  const boundaryAliases = new Map(routes.map((route, index) => [route.id, boundaryPaths[index] ? boundaryImports.get(boundaryPaths[index]!) : undefined]));
  const prefetchEntries = routes.filter(route => route.module).map(route => `${JSON.stringify(route.id)}:()=>import(${JSON.stringify(routeModules.get(route.id))})`);
  const prefetchOption = prefetchEntries.length ? ',prefetch' : '';
  const children = new Map<string | undefined, RouteRecord[]>();
  for (const route of routes) { const list = children.get(route.parentId) ?? []; list.push(route); children.set(route.parentId, list); }
  const render = (parent?: string): string => '[' + (children.get(parent) ?? []).map(route => {
    const pageFields = [`id:${JSON.stringify(route.id)}`];
    pageFields.push(`handle:{cormi:{meta:${JSON.stringify(route.meta ?? {})}}}`);
    if (route.index) pageFields.push('index:true'); else if (route.path !== undefined) pageFields.push(`path:${JSON.stringify(route.access ? '' : route.path)}`);
    if (route.redirect) pageFields.push(`element:<RedirectRoute to=${JSON.stringify(route.redirect)}${route.keepQuery ? ' keepQuery' : ''}/>`);
    else if (route.module) {
      const specifier = JSON.stringify(routeModules.get(route.id));
      // A loader returned from `lazy` is never merged when it throws, so the loader stays a static property that
      // imports the page itself; only the component is lazy. This keeps the route's own boundary reachable.
      if (route.clientLoader !== undefined) {
        pageFields.push(`loader:async(args)=>{const page=await import(${specifier});return clientLoaderOf(page,${JSON.stringify(route.clientLoader)},${JSON.stringify(route.id)})(args)}`);
      } else if (route.serverLoader !== undefined) {
        // The browser never executes the page's serverLoader; navigation asks the SSR endpoint instead.
        pageFields.push(`loader:serverLoaderOf(${JSON.stringify(route.id)},${JSON.stringify(base)})`);
      }
      pageFields.push(`lazy:async()=>({Component:await resolveRouteComponent(async()=>(await import(${specifier}))[${JSON.stringify(route.module.exportName)}])})`);
    }
    if (route.errorBoundary) pageFields.push('hasErrorBoundary:true', `ErrorBoundary:${boundaryAliases.get(route.id)}[${JSON.stringify(route.errorBoundary.exportName)}]`);
    if (children.has(route.id)) pageFields.push(`children:${render(route.id)}`);
    if (!route.access) return '{' + pageFields.join(',') + '}';
    const guard = [`id:${JSON.stringify(route.id + ':access')}`, `handle:{cormi:{meta:{},access:${JSON.stringify(route.access)}}}`];
    if (!route.index && route.path !== undefined) guard.push(`path:${JSON.stringify(route.path)}`);
    guard.push(`element:<AccessRoute name=${JSON.stringify(route.access)}/>`, `children:[{${pageFields.join(',')}}]`);
    return '{' + guard.join(',') + '}';
  }).join(',\n') + ']';
  const hasRedirects = routes.some(route => route.redirect !== undefined);
  const hasAccess = routes.some(route => route.access !== undefined);
  const modelEntries = models.map((model, index) => `{namespace:${JSON.stringify(model.namespace)},model:model${index}[${JSON.stringify(model.module.exportName)}]}`);
  const modelsOption = modelEntries.length ? ',models' : '';
  const hasClientLoader = routes.some(route => route.clientLoader !== undefined);
  const hasServerLoader = routes.some(route => route.serverLoader !== undefined);
  const styleImports = styles.map(style => `import ${JSON.stringify(styleSpecifier(root, style.file))};`);
  const accessModule = access ? await clientSpecifier(root, access, forbidden) : undefined;
  let configExpression = appModule ? `resolveAppConfig(${appValue},${JSON.stringify(appRuntime?.keys ?? [])})` : '';
  if (accessModule) configExpression = `applyAccessConvention(${configExpression || 'resolveAppConfig({},[])'},accessConvention.default)`;
  if (localeCatalogs.length) configExpression = `applyLocaleCatalogs(${configExpression || 'resolveAppConfig({},[])'},${JSON.stringify(localeCatalogs)})`;
  const appOption = configExpression ? `,appConfig:${configExpression}` : '';
  return [
    ...styleImports,
    ...(accessModule ? [`import * as accessConvention from ${JSON.stringify(accessModule)};`] : []),
    `import { ${hasRedirects ? 'RedirectRoute, ' : ''}${hasAccess ? 'AccessRoute, ' : ''}mountApplication, resolveRouteComponent, type RuntimeEntry${appModule || accessModule || localeCatalogs.length ? ', resolveAppConfig' : ''}${hasClientLoader ? ', clientLoaderOf' : ''}${hasServerLoader ? ', serverLoaderOf' : ''}${accessModule ? ', applyAccessConvention' : ''}${localeCatalogs.length ? ', applyLocaleCatalogs' : ''} } from '@cormijs/runtime';`,
    ...(appModule ? [`import * as applicationConfig from ${JSON.stringify(appModule)};`] : []),
    ...(loadingModule ? [`import * as applicationLoading from ${JSON.stringify(loadingModule)};`] : []),
    ...modelModules.map((path, i) => `import * as model${i} from ${JSON.stringify(path)};`),
    `import type { RouteObject } from 'react-router';`,
    ...[...boundaryImports].map(([path, alias]) => `import * as ${alias} from ${JSON.stringify(path)};`),
    ...runtimeModules.map((path, i) => `import * as runtime${i} from ${JSON.stringify(path)};`),
    `const routes: RouteObject[] = ${render()};`,
    ...(modelEntries.length ? [`const models = [${modelEntries.join(',')}];`] : []),
    `const plugins: RuntimeEntry[] = [${runtimes.map((item, i) => `{id:${JSON.stringify(item.id)},plugin:runtime${i}[${JSON.stringify(item.module.exportName)}],options:${JSON.stringify(item.options)}}`).join(',')}];`,
    ...(prefetchEntries.length ? [`const prefetch = {${prefetchEntries.join(',')}};`] : []),
    `export const cormiApplication = {routes,plugins${modelsOption}${prefetchOption},base:${JSON.stringify(base)},strict:${JSON.stringify(strict)}${appOption}${loadingOption}${historyOption}};`,
    `if (typeof document !== 'undefined' && !(globalThis as {__CORMI_MICRO_APP__?: boolean}).__CORMI_MICRO_APP__) {`,
    `  const element = document.getElementById(${JSON.stringify(mountId)});`,
    `  if (!element) throw new Error('cormi mount element is missing');`,
    `  void Promise.resolve().then(()=>mountApplication({element,...cormiApplication,hydrate:element.childNodes.length>0})).catch(error=>{console.error(error);element.textContent='Application startup failed';});`,
    `}`,
    '',
  ].join('\n');
}

/**
 * Server-only module imported exclusively by the SSR entry. It binds page serverLoader exports without
 * making them a static application dependency; page modules stay browser dependencies for their components.
 */
export async function generateServerLoaders(root: string, routes: readonly RouteRecord[], serverOnlyFiles: readonly string[] = []): Promise<string> {
  const entries = routes.filter(route => route.module && route.serverLoader !== undefined);
  if (!entries.length) return 'export const serverLoaders = Object.freeze(Object.fromEntries([]));\n';
  const forbidden = new Set(serverOnlyFiles), pages = new Map<string, string>();
  const rows: string[] = [];
  for (const route of entries) {
    const specifier = await clientSpecifier(root, route.module!, forbidden);
    if (!pages.has(specifier)) pages.set(specifier, `serverLoaderPage${pages.size}`);
    rows.push(`  [${JSON.stringify(route.id)}, serverLoaderExport(${pages.get(specifier)}, ${JSON.stringify(route.serverLoader)}, ${JSON.stringify(route.id)})],`);
  }
  return [
    `import { serverLoaderExport } from '@cormijs/runtime/server';`,
    ...[...pages].map(([specifier, alias]) => `import * as ${alias} from ${JSON.stringify(specifier)};`),
    `export const serverLoaders = Object.freeze(Object.fromEntries([`,
    ...rows,
    `]));`,
    '',
  ].join('\n');
}
