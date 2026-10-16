import { CormiError } from '@cormijs/core';
import { moduleRef, projectPath, type ModuleRef, type RouteRecord } from '@cormijs/routes';
import { realpath, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

export interface RuntimeContribution { readonly id: string; readonly module: ModuleRef; readonly options?: unknown }
export const isServerModule = (name: string): boolean => name === 'cormijs' || name.startsWith('cormijs/')
  || /^@cormijs\/(?:core|builder|routes|plugin-[^/]+|preset-[^/]+)(?:\/|$)/.test(name) || name.startsWith('node:');
function jsonData(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) throw new CormiError('RUNTIME_OPTIONS_INVALID', 'Runtime options must be finite acyclic JSON data.');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map(item => jsonData(item, seen));
    if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new CormiError('RUNTIME_OPTIONS_INVALID', 'Runtime options must be plain JSON objects.');
    return Object.fromEntries(Object.entries(value).map(([key, item]) => {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new CormiError('RUNTIME_OPTIONS_INVALID', 'Reserved option key.');
      return [key, jsonData(item, seen)];
    }));
  } finally { seen.delete(value); }
}
export function runtimeContributions(input: unknown): readonly RuntimeContribution[] {
  if (!Array.isArray(input) || input.length > 256) throw new CormiError('RUNTIME_INVALID', 'Expected at most 256 runtime modules.');
  const ids = new Set<string>();
  return Object.freeze(input.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CormiError('RUNTIME_INVALID', 'Expected a runtime contribution.');
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some(key => !['id', 'module', 'options'].includes(key)) || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new CormiError('RUNTIME_ID_CONFLICT', 'Invalid or duplicate runtime id.');
    ids.add(item.id);
    return Object.freeze({ id: item.id, module: moduleRef(item.module), options: jsonData(item.options ?? {}) });
  }));
}
async function specifier(root: string, ref: ModuleRef, forbidden: ReadonlySet<string>): Promise<string> {
  if (isServerModule(ref.specifier)) throw new CormiError('CLIENT_SERVER_IMPORT', 'Node SDK cannot be imported into a browser application.', { specifier: ref.specifier });
  if (!ref.specifier.startsWith('.')) return ref.specifier;
  const path = projectPath(root, ref.specifier), actual = await realpath(path);
  if (actual !== path || forbidden.has(actual) || /(?:^|[\\/])(?:\.cormi|\.env|cormi\.config\.)/.test(relative(root, actual))
    || /\.server\.[cm]?[jt]sx?$/.test(actual) || !/\.[cm]?[jt]sx?$/.test(actual) || !(await stat(actual)).isFile()) {
    throw new CormiError('CLIENT_MODULE_INVALID', 'Browser module must be a non-private project source file.', { specifier: ref.specifier });
  }
  const pathFromEntry = relative(join(root, '.cormi'), actual).split(sep).join('/');
  return pathFromEntry.startsWith('.') ? pathFromEntry : './' + pathFromEntry;
}
/** Static imports and JSON string literals only; no user-provided expression interpolation. */
export async function generateApplication(root: string, routes: readonly RouteRecord[], runtimes: readonly RuntimeContribution[],
  base: string, mountId: string, serverOnlyFiles: readonly string[] = []): Promise<string> {
  const forbidden = new Set(serverOnlyFiles);
  const routeModules = new Map<string, string>();
  await Promise.all(routes.map(async route => { if (route.module) routeModules.set(route.id, await specifier(root, route.module, forbidden)); }));
  const runtimeModules = await Promise.all(runtimes.map(item => specifier(root, item.module, forbidden)));
  const children = new Map<string | undefined, RouteRecord[]>();
  for (const route of routes) { const list = children.get(route.parentId) ?? []; list.push(route); children.set(route.parentId, list); }
  const render = (parent?: string): string => '[' + (children.get(parent) ?? []).map(route => {
    const fields = [`id:${JSON.stringify(route.id)}`];
    if (route.index) fields.push('index:true'); else if (route.path !== undefined) fields.push(`path:${JSON.stringify(route.path)}`);
    if (route.module) fields.push(`lazy:async()=>({Component:(await import(${JSON.stringify(routeModules.get(route.id))}))[${JSON.stringify(route.module.exportName)}]})`);
    if (children.has(route.id)) fields.push(`children:${render(route.id)}`);
    return '{' + fields.join(',') + '}';
  }).join(',\n') + ']';
  return [
    `import { mountApplication } from '@cormijs/runtime';`,
    ...runtimeModules.map((path, i) => `import * as runtime${i} from ${JSON.stringify(path)};`),
    `const routes = ${render()};`,
    `const plugins = [${runtimes.map((item, i) => `{id:${JSON.stringify(item.id)},plugin:runtime${i}[${JSON.stringify(item.module.exportName)}],options:${JSON.stringify(item.options)}}`).join(',')}];`,
    `const element = document.getElementById(${JSON.stringify(mountId)});`,
    `if (!element) throw new Error('cormi mount element is missing');`,
    `mountApplication({element,routes,plugins,base:${JSON.stringify(base)}}).catch(error=>{console.error(error);element.textContent='Application startup failed';});`,
    '',
  ].join('\n');
}
