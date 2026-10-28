import { CormiError } from '@cormijs/core';
import type { RouteRecord } from '@cormijs/routes';
import { pageFiles, routesFromFiles, validateRoutes, applyGlobalLayout } from '@cormijs/routes';
import { readdir } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { transform } from 'esbuild';
import { generateApplication, generateServerLoaders, type HistoryType } from './generate.js';
import { generateRouteTypes } from './types.js';
import { clientModuleFile, clientSpecifier, inspectModule } from './modules.js';
import { appConfigContributions, appRuntimeFiles, resolveAppRuntime, type AppRuntimePlan } from './app-runtime.js';
import { layoutContributions, layoutFilesToWatch, resolveGlobalLayout } from './layout.js';
import { loadingContributions, loadingFilesToWatch, resolveGlobalLoading } from './loading.js';
import { resolveGlobalStyles, styleContributions, styleFilesToWatch } from './global-style.js';
import { accessContributions, accessFilesToWatch, resolveAccessPlan } from './access.js';
import { pageLoaderExports } from './page-loaders.js';
import { generateLocaleTypes, localeCatalogSources, readLocaleCatalogs, type LocaleCatalog, type LocaleCatalogSource } from './locale.js';
import { generateLoaderTypes, type LoaderTypeEntry } from './loaders.js';
import { generateStyleTypes } from './style-types.js';
import { modelContributions, modelFiles, modelWatchPaths, resolveModels, type ModelPlan } from './model.js';
import { repairSignature } from './development.js';
import type { ReactCompilation } from './index.js';
import type { GeneratedInspection } from '@cormijs/plugin-web';
import { inspectionManifest } from '@cormijs/plugin-web';
import { buildApplicationManifest } from './manifest-builder.js';

export interface ObservationResult {
  readonly files: readonly string[];
  readonly error: unknown;
  readonly key: string;
  readonly applicationRuntime: AppRuntimePlan;
  readonly appRevision: number;
}

export type CompilePhase = 'scan' | 'routes' | 'runtime' | 'generate' | 'commit';

export interface ObservationContext {
  readonly root: string;
  readonly pages: string;
  readonly input: Record<string, unknown>;
  readonly repairFiles: Set<string>;
  readonly anchoredFiles: Set<string>;
  readonly react: ReactCompilation;
}

export function createObserveFn(ctx: ObservationContext): () => Promise<ObservationResult> {
  const { root, pages, input, repairFiles, anchoredFiles, react } = ctx;

  async function localeCatalogFiles(source: LocaleCatalogSource): Promise<string[]> {
    const directory = source.directory;
    if (directory === undefined) return [];
    try {
      return (await readdir(join(root, directory)))
        .filter(name => name.endsWith('.json'))
        .sort()
        .map(name => join(directory, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }

  return async function observe(): Promise<ObservationResult> {
    let files: readonly string[] = [], error: unknown;
    try {
      files = input.routes !== undefined ? [] : await pageFiles(root, pages);
    } catch (cause) {
      error = cause;
    }

    const appRevision = react.appConfig.revision;
    let applicationRuntime: AppRuntimePlan = { keys: [] };
    let appFiles: string[] = [];
    let layoutInputFiles: string[] = [];
    let loadingInputFiles: string[] = [];
    let styleInputFiles: string[] = [];
    let accessInputFiles: string[] = [];
    let localeFiles: string[] = [];
    let modelInputFiles: string[] = [];

    try {
      const sources = appConfigContributions([
        ...(input.runtimeConfig === undefined ? [] : [{ id: 'config:runtime', module: input.runtimeConfig }]),
        ...await react.appConfig.collect(undefined)
      ]);
      appFiles = appRuntimeFiles(root, sources);
      applicationRuntime = await resolveAppRuntime(root, sources);
      layoutInputFiles = layoutFilesToWatch(layoutContributions(await react.layouts.collect(undefined)));
      loadingInputFiles = loadingFilesToWatch(loadingContributions(await react.loading.collect(undefined)));
      styleInputFiles = styleFilesToWatch(styleContributions(await react.styles.collect(undefined)));
      accessInputFiles = accessFilesToWatch(accessContributions(await react.access.collect(undefined)));
      const catalogSources = localeCatalogSources(await react.locale.collect(undefined));
      localeFiles = (await Promise.all(catalogSources.map(localeCatalogFiles))).flat();
      const modelSources = modelContributions(await react.models.collect(undefined));
      modelInputFiles = [...modelWatchPaths(modelSources), ...await modelFiles(root, modelSources)];
    } catch (cause) {
      error ??= cause;
    }

    const watched = new Set([...anchoredFiles, ...appFiles.filter(isAbsolute)]);
    const key = JSON.stringify([
      files,
      await repairSignature(root, [...files, ...repairFiles, ...watched, ...appFiles, ...layoutInputFiles, ...loadingInputFiles, ...styleInputFiles, ...accessInputFiles, ...localeFiles], watched),
      react.routes.revision,
      react.runtime.revision,
      react.layouts.revision,
      react.loading.revision,
      react.styles.revision,
      react.access.revision,
      react.locale.revision,
      react.models.revision,
      appRevision,
      error instanceof Error ? [(error as NodeJS.ErrnoException).code, error.message] : null
    ]);

    return { files, error, key, applicationRuntime, appRevision };
  };
}

export interface CompilationInputs {
  readonly observed: ObservationResult;
  readonly root: string;
  readonly pages: string;
  readonly input: Record<string, unknown>;
  readonly base: string;
  readonly mountId: string;
  readonly strict: boolean;
  readonly history: HistoryType;
  readonly ssr: boolean;
  readonly serverOnlyFiles: ReadonlySet<string> | readonly string[];
  readonly rememberModules: (items: unknown) => void;
  readonly react: ReactCompilation;
}

export interface CompilationOutput {
  readonly code: string;
  readonly types: string;
  readonly localeTypes: string;
  readonly loaderTypes: string;
  readonly styleTypes: string;
  readonly serverLoaders: string;
  readonly inspection: GeneratedInspection;
  readonly manifest: string;
}

export async function runCompilation(inputs: CompilationInputs): Promise<CompilationOutput> {
  const { observed, root, pages, input, base, mountId, strict, history, ssr, serverOnlyFiles, rememberModules, react } = inputs;

  if (observed.error) throw observed.error;

  // Normalize serverOnlyFiles to Set
  const serverOnlySet = serverOnlyFiles instanceof Set ? serverOnlyFiles : new Set(serverOnlyFiles);

  // Capture plugin revisions at the start
  const routeRevision = react.routes.revision;
  const runtimeRevision = react.runtime.revision;
  const layoutRevision = react.layouts.revision;
  const loadingRevision = react.loading.revision;
  const styleRevision = react.styles.revision;
  const accessRevision = react.access.revision;
  const localeRevision = react.locale.revision;
  const modelRevision = react.models.revision;

  const routeOrder = react.routes.snapshot();
  const runtimeOrder = react.runtime.snapshot();
  const layoutOrder = react.layouts.snapshot();
  const loadingOrder = react.loading.snapshot();
  const styleOrder = react.styles.snapshot();
  const accessOrder = react.access.snapshot();
  const localeOrder = react.locale.snapshot();
  const modelOrder = react.models.snapshot();

  const initialRoutes = input.routes !== undefined
    ? validateRoutes(input.routes)
    : await (async () => {
        const scanned = await pageLoaderExports(root, observed.files);
        return routesFromFiles(observed.files, pages, scanned.clientLoaders, scanned.serverLoaders);
      })();

  const baseRoutes = validateRoutes(await react.routes.reduce(initialRoutes, (value): value is readonly RouteRecord[] => Array.isArray(value)));

  const layoutSources = layoutContributions(await react.layouts.collect(undefined));
  const globalLayout = await resolveGlobalLayout(root, layoutSources);
  if (globalLayout) rememberModules([{ module: globalLayout.module }]);

  const loadingSources = loadingContributions(await react.loading.collect(undefined));
  const globalLoading = await resolveGlobalLoading(root, loadingSources);
  if (globalLoading) rememberModules([{ module: globalLoading.module }]);

  const styleSources = styleContributions(await react.styles.collect(undefined));
  const globalStyles = await resolveGlobalStyles(root, styleSources);

  const accessPlan = await resolveAccessPlan(root, accessContributions(await react.access.collect(undefined)));
  if (accessPlan) rememberModules([{ module: accessPlan.module }]);

  const catalogs = await readLocaleCatalogs(root, localeCatalogSources(await react.locale.collect(undefined)));

  const modelSources = modelContributions(await react.models.collect(undefined));
  const modelPlans = await resolveModels(root, modelSources);
  rememberModules(modelPlans.map(model => ({ module: model.module })));

  const next = validateRoutes(globalLayout ? applyGlobalLayout(baseRoutes, { module: globalLayout.module, pluginId: globalLayout.owner }) : baseRoutes);

  const serverRoute = next.find(route => route.serverLoader !== undefined);
  if (serverRoute && !ssr) {
    throw new CormiError('ROUTE_SERVER_LOADER_UNSUPPORTED', 'A serverLoader route requires app.ssr: true and the SSR plugin.', { id: serverRoute.id });
  }

  rememberModules(next);

  const plugins = await (async () => {
    const { runtimeContributions } = await import('./generate.js');
    return runtimeContributions([...runtimeContributions(input.runtime ?? []), ...await react.runtime.collect(undefined)]);
  })();
  rememberModules(plugins);

  const code = await generateApplication(
    root, next, plugins, base, mountId, [...serverOnlySet], strict,
    observed.applicationRuntime, globalLoading?.module, history,
    modelPlans, globalStyles, accessPlan?.module, catalogs
  );

  await transform(code, { loader: 'tsx', format: 'esm', jsx: 'automatic', logLevel: 'silent' });

  const types = generateRouteTypes(next, modelPlans.map(model => model.namespace));
  const localeTypes = generateLocaleTypes(catalogs);

  const loaderEntries: LoaderTypeEntry[] = await Promise.all(
    next
      .filter(route => route.module && (route.clientLoader !== undefined || route.serverLoader !== undefined))
      .map(async route => ({
        id: route.id,
        specifier: await clientSpecifier(root, route.module!, serverOnlySet),
        exportName: (route.clientLoader ?? route.serverLoader)!,
      }))
  );
  const loaderTypes = generateLoaderTypes(loaderEntries);

  const serverLoaders = await generateServerLoaders(root, next, [...serverOnlySet]);
  await transform(serverLoaders, { loader: 'tsx', format: 'esm', jsx: 'automatic', logLevel: 'silent' });

  const hookInfo = (items: readonly { id: string; owner: string; stage?: number }[]) =>
    items.map(({ id, owner, stage }) => ({ id, owner, stage: stage ?? 0 }));

  const inspection = inspectionManifest(code, types, {
    renderer: 'react',
    mode: input.mode as string,
    base,
    entry: '.cormi/app.tsx',
    strict,
    history,
    routes: next.map(route => ({
      ...route,
      ...(route.module ? { module: inspectModule(root, route.module) } : {}),
      ...(route.errorBoundary ? { errorBoundary: inspectModule(root, route.errorBoundary) } : {})
    })),
    layout: globalLayout ? { owner: globalLayout.owner, module: inspectModule(root, globalLayout.module) } : null,
    loading: globalLoading ? { owner: globalLoading.owner, module: inspectModule(root, globalLoading.module) } : null,
    styles: globalStyles.map(style => ({ owner: style.owner, file: style.file })),
    access: accessPlan ? { owner: accessPlan.owner, module: inspectModule(root, accessPlan.module) } : null,
    localeCatalogs: catalogs.map(catalog => ({ locale: catalog.locale, keys: Object.keys(catalog.messages).length })),
    models: modelPlans.map(model => ({ namespace: model.namespace, module: inspectModule(root, model.module) })),
    runtime: plugins.map(({ id, module }) => ({ id, module: inspectModule(root, module) })),
    appRuntime: { ...observed.applicationRuntime, ...(observed.applicationRuntime.module ? { module: inspectModule(root, observed.applicationRuntime.module) } : {}) },
    hooks: {
      routes: hookInfo(routeOrder),
      runtime: hookInfo(runtimeOrder),
      layouts: hookInfo(layoutOrder),
      loading: hookInfo(loadingOrder),
      styles: hookInfo(styleOrder),
      access: hookInfo(accessOrder),
      locale: hookInfo(localeOrder),
      models: hookInfo(modelOrder)
    }
  });

  // Verify that plugin revisions haven't changed during compilation
  if (react.routes.revision !== routeRevision || react.runtime.revision !== runtimeRevision ||
      react.layouts.revision !== layoutRevision || react.loading.revision !== loadingRevision ||
      react.styles.revision !== styleRevision || react.access.revision !== accessRevision ||
      react.locale.revision !== localeRevision || react.models.revision !== modelRevision ||
      react.appConfig.revision !== observed.appRevision) {
    throw new CormiError('CONTRIBUTIONS_CHANGED', 'Plugin contributions changed during compilation; this result cannot be published.');
  }

  // Build the ApplicationManifest
  const appManifest = await buildApplicationManifest({
    buildId: inspection.generation,
    base,
    history,
    mountId,
    strict,
    ssr,
    routes: next,
    plugins,
    appRuntime: observed.applicationRuntime,
    locale: catalogs.length > 0 ? { catalogs } : undefined,
    models: modelPlans.length > 0 ? modelPlans : undefined,
    access: accessPlan ? { module: accessPlan.module, owner: accessPlan.owner } : undefined,
    layout: globalLayout ? { module: globalLayout.module, owner: globalLayout.owner } : undefined,
    loading: globalLoading ? { module: globalLoading.module, owner: globalLoading.owner } : undefined,
    globalStyles: globalStyles.length > 0 ? globalStyles : undefined,
    root,
    serverOnlyFiles: serverOnlySet,
  });

  return {
    code,
    types,
    localeTypes,
    loaderTypes,
    styleTypes: react.styleTypes.snapshot().length ? generateStyleTypes() : '',
    serverLoaders,
    inspection,
    manifest: JSON.stringify(appManifest, null, 2) + '\n',
  };
}
