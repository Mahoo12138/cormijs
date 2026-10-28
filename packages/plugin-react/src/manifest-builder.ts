import type { ApplicationManifest, ManifestRoute, ManifestPlugin, ManifestModel, ManifestAccess, ManifestLayout, ManifestLoading, ManifestGlobalStyle, ManifestLocaleCatalog } from '@cormijs/core';
import type { RouteRecord, ModuleRef } from '@cormijs/routes';
import { clientSpecifier } from './modules.js';
import type { RuntimeContribution, HistoryType } from './generate.js';
import type { AppRuntimePlan } from './app-runtime.js';
import type { ModelPlan } from './model.js';
import type { GlobalStylePlan } from './global-style.js';
import type { LocaleCatalog } from './locale.js';

/**
 * Build the typed ApplicationManifest from compilation results.
 * This manifest is the runtime contract between the Node generator and browser loader.
 */
export async function buildApplicationManifest(params: {
  buildId: string;
  base: string;
  history: HistoryType;
  mountId: string;
  strict: boolean;
  ssr: boolean;
  routes: readonly RouteRecord[];
  plugins: readonly RuntimeContribution[];
  appRuntime: AppRuntimePlan;
  locale?: { default?: string; fallback?: string; catalogs: readonly LocaleCatalog[] };
  models?: readonly ModelPlan[];
  access?: { module: ModuleRef; owner: string };
  layout?: { module: ModuleRef; owner: string };
  loading?: { module: ModuleRef; owner: string };
  globalStyles?: readonly GlobalStylePlan[];
  root: string;
  serverOnlyFiles: ReadonlySet<string> | readonly string[];
}): Promise<ApplicationManifest> {
  const { buildId, base, history, mountId, strict, ssr, routes, plugins, appRuntime, locale, models, access, layout, loading, globalStyles, root, serverOnlyFiles } = params;

  const serverOnlySet = serverOnlyFiles instanceof Set ? serverOnlyFiles : new Set(serverOnlyFiles);

  // Convert flat routes to nested tree structure
  const routeTree = await buildRouteTree(routes, root, serverOnlySet);

  // Convert runtime plugins to manifest plugins
  const manifestPlugins: ManifestPlugin[] = await Promise.all(
    plugins.map(async (plugin) => ({
      id: plugin.id,
      module: await clientSpecifier(root, plugin.module, serverOnlySet),
      options: plugin.options,
    }))
  );

  // Build base manifest
  const baseManifest = {
    version: '1' as const,
    buildId,
    base,
    history,
    mountId,
    strict,
    ssr,
    routes: routeTree,
    plugins: manifestPlugins,
    appRuntime: {
      ...(appRuntime.module ? { module: await clientSpecifier(root, appRuntime.module, serverOnlySet) } : {}),
      keys: appRuntime.keys,
    },
  };

  // Build optional sections
  const optionalSections: Record<string, any> = {};

  if (locale && locale.catalogs.length > 0) {
    optionalSections.locale = {
      ...(locale.default ? { default: locale.default } : {}),
      ...(locale.fallback ? { fallback: locale.fallback } : {}),
      catalogs: locale.catalogs.map(cat => ({
        locale: cat.locale,
        messages: cat.messages,
      })),
    };
  }

  if (models && models.length > 0) {
    optionalSections.models = await Promise.all(
      models.map(async (model) => ({
        namespace: model.namespace,
        module: await clientSpecifier(root, model.module, serverOnlySet),
      }))
    );
  }

  if (access) {
    optionalSections.access = {
      module: await clientSpecifier(root, access.module, serverOnlySet),
    };
  }

  if (layout) {
    optionalSections.layout = {
      module: await clientSpecifier(root, layout.module, serverOnlySet),
      owner: layout.owner,
    };
  }

  if (loading) {
    optionalSections.loading = {
      module: await clientSpecifier(root, loading.module, serverOnlySet),
      owner: loading.owner,
    };
  }

  if (globalStyles && globalStyles.length > 0) {
    optionalSections.globalStyles = globalStyles.map(style => ({
      module: style.file,
      owner: style.owner,
    }));
  }

  return { ...baseManifest, ...optionalSections } as ApplicationManifest;
}

/**
 * Convert flat RouteRecord[] to nested ManifestRoute tree using parentId.
 */
async function buildRouteTree(
  routes: readonly RouteRecord[],
  root: string,
  serverOnlySet: ReadonlySet<string>
): Promise<readonly ManifestRoute[]> {
  const routeMap = new Map<string, RouteRecord>();
  const children = new Map<string | undefined, RouteRecord[]>();

  // Build maps
  for (const route of routes) {
    routeMap.set(route.id, route);
    const parentId = route.parentId;
    if (!children.has(parentId)) {
      children.set(parentId, []);
    }
    children.get(parentId)!.push(route);
  }

  // Recursively build tree
  async function buildNode(route: RouteRecord): Promise<ManifestRoute> {
    const baseNode: Partial<ManifestRoute> = {
      id: route.id,
      ...(route.path !== undefined ? { path: route.path } : {}),
      ...(route.index ? { index: true } : {}),
      ...(route.module ? { module: await clientSpecifier(root, route.module, serverOnlySet) } : {}),
      ...(route.errorBoundary ? { errorBoundary: await clientSpecifier(root, route.errorBoundary, serverOnlySet) } : {}),
      ...(route.clientLoader !== undefined ? { clientLoader: route.clientLoader } : {}),
      ...(route.serverLoader !== undefined ? { serverLoader: route.serverLoader } : {}),
      ...(route.meta ? { meta: route.meta as Record<string, unknown> } : {}),
    };

    const routeChildren = children.get(route.id);
    if (routeChildren && routeChildren.length > 0) {
      const childNodes = await Promise.all(routeChildren.map(buildNode));
      return { ...baseNode, children: childNodes } as ManifestRoute;
    }

    return baseNode as ManifestRoute;
  }

  // Build roots (routes without parent)
  const roots = children.get(undefined) ?? [];
  return Promise.all(roots.map(buildNode));
}
