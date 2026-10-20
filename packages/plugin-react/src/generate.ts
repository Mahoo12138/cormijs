import { CormiError } from '@cormijs/core';
import { moduleRef, jsonData, validateRoutes, type ModuleRef, type RouteRecord } from '@cormijs/routes';
import { clientSpecifier } from './modules.js';
import type { AppRuntimePlan } from './app-runtime.js';
export { isServerModule } from './modules.js';

export interface RuntimeContribution { readonly id: string; readonly module: ModuleRef; readonly options?: unknown }
export function runtimeContributions(input: unknown): readonly RuntimeContribution[] {
  if (!Array.isArray(input) || input.length > 256) throw new CormiError('RUNTIME_INVALID', 'Expected at most 256 runtime modules.');
  const ids = new Set<string>();
  return Object.freeze(input.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CormiError('RUNTIME_INVALID', 'Expected a runtime contribution.');
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some(key => !['id', 'module', 'options'].includes(key)) || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new CormiError('RUNTIME_ID_CONFLICT', 'Invalid or duplicate runtime id.');
    ids.add(item.id);
    return Object.freeze({ id: item.id, module: moduleRef(item.module), options: jsonData(item.options ?? {}, 'RUNTIME_OPTIONS_INVALID') });
  }));
}
/** Static imports and JSON string literals only; no user-provided expression interpolation. */
export async function generateApplication(root: string, routes: readonly RouteRecord[], runtimes: readonly RuntimeContribution[],
  base: string, mountId: string, serverOnlyFiles: readonly string[] = [], strict = false, appRuntime?: AppRuntimePlan, loading?: ModuleRef): Promise<string> {
  if (typeof strict !== 'boolean') throw new CormiError('CONFIG_INVALID', 'strict must be boolean.');
  routes = validateRoutes(routes); runtimes = runtimeContributions(runtimes);
  const forbidden = new Set(serverOnlyFiles);
  const appModule = appRuntime?.module ? await clientSpecifier(root, appRuntime.module, forbidden) : undefined;
  const appValue = appRuntime?.module?.exportName === '*' ? 'applicationConfig' : `{default:applicationConfig[${JSON.stringify(appRuntime?.module?.exportName)}]}`;
  const appOption = appModule ? `,appConfig:resolveAppConfig(${appValue},${JSON.stringify(appRuntime?.keys ?? [])})` : '';
  const loadingModule = loading ? await clientSpecifier(root, loading, forbidden) : undefined;
  const loadingOption = loadingModule ? `,loading:applicationLoading[${JSON.stringify(loading!.exportName)}]` : '';
  const routeModules = new Map<string, string>();
  await Promise.all(routes.map(async route => { if (route.module) routeModules.set(route.id, await clientSpecifier(root, route.module, forbidden)); }));
  const runtimeModules = await Promise.all(runtimes.map(item => clientSpecifier(root, item.module, forbidden)));
  // Boundaries must exist before page lazy resolution. Loading both in one lazy callback cannot catch its own import failure.
  const boundaryPaths = await Promise.all(routes.map(route => route.errorBoundary ? clientSpecifier(root, route.errorBoundary, forbidden) : undefined));
  const boundaryImports = new Map<string, string>();
  for (const path of boundaryPaths) if (path && !boundaryImports.has(path)) boundaryImports.set(path, `boundary${boundaryImports.size}`);
  const boundaryAliases = new Map(routes.map((route, index) => [route.id, boundaryPaths[index] ? boundaryImports.get(boundaryPaths[index]!) : undefined]));
  const children = new Map<string | undefined, RouteRecord[]>();
  for (const route of routes) { const list = children.get(route.parentId) ?? []; list.push(route); children.set(route.parentId, list); }
  const render = (parent?: string): string => '[' + (children.get(parent) ?? []).map(route => {
    const fields = [`id:${JSON.stringify(route.id)}`];
    fields.push(`handle:{cormi:{meta:${JSON.stringify(route.meta ?? {})}}}`);
    if (route.index) fields.push('index:true'); else if (route.path !== undefined) fields.push(`path:${JSON.stringify(route.path)}`);
    if (route.redirect) fields.push(`element:<RedirectRoute to=${JSON.stringify(route.redirect)}${route.keepQuery ? ' keepQuery' : ''}/>`);
    else if (route.module) fields.push(`lazy:async()=>({Component:await resolveRouteComponent(async()=>(await import(${JSON.stringify(routeModules.get(route.id))}))[${JSON.stringify(route.module.exportName)}])})`);
    if (route.errorBoundary) fields.push(`ErrorBoundary:${boundaryAliases.get(route.id)}[${JSON.stringify(route.errorBoundary.exportName)}]`);
    if (children.has(route.id)) fields.push(`children:${render(route.id)}`);
    return '{' + fields.join(',') + '}';
  }).join(',\n') + ']';
  const hasRedirects = routes.some(route => route.redirect !== undefined);
  return [
    `import { ${hasRedirects ? 'RedirectRoute, ' : ''}mountApplication, resolveRouteComponent, type RuntimeEntry${appModule ? ', resolveAppConfig' : ''} } from '@cormijs/runtime';`,
    ...(appModule ? [`import * as applicationConfig from ${JSON.stringify(appModule)};`] : []),
    ...(loadingModule ? [`import * as applicationLoading from ${JSON.stringify(loadingModule)};`] : []),
    `import type { RouteObject } from 'react-router';`,
    ...[...boundaryImports].map(([path, alias]) => `import * as ${alias} from ${JSON.stringify(path)};`),
    ...runtimeModules.map((path, i) => `import * as runtime${i} from ${JSON.stringify(path)};`),
    `const routes: RouteObject[] = ${render()};`,
    `const plugins: RuntimeEntry[] = [${runtimes.map((item, i) => `{id:${JSON.stringify(item.id)},plugin:runtime${i}[${JSON.stringify(item.module.exportName)}],options:${JSON.stringify(item.options)}}`).join(',')}];`,
    `const element = document.getElementById(${JSON.stringify(mountId)});`,
    `if (!element) throw new Error('cormi mount element is missing');`,
    `void Promise.resolve().then(()=>mountApplication({element,routes,plugins,base:${JSON.stringify(base)},strict:${JSON.stringify(strict)}${appOption}${loadingOption}})).catch(error=>{console.error(error);element.textContent='Application startup failed';});`,
    '',
  ].join('\n');
}
