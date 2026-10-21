import { assertActive, CormiError, type Plugin } from '@cormijs/core';
import type { DevelopmentState } from '@cormijs/builder';
import { AtomicEntry, RevisionQueue, OrderedHooks, createBuildPlan, inspectionManifest, type ApplicationRequest, type PreparedApplication, type GeneratedInspection } from '@cormijs/plugin-web';
import { pageFiles, routesFromFiles, validateRoutes, applyGlobalLayout, type RouteRecord } from '@cormijs/routes';
import { readdir, realpath, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { transform } from 'esbuild';
import { generateApplication, runtimeContributions, type HistoryType, type RuntimeContribution } from './generate.js';
import { generateRouteTypes } from './types.js';
import { developmentDiagnostic, recoverable, repairSignature } from './development.js';
import { clientModuleFile, inspectModule } from './modules.js';
import { appConfigContributions, appRuntimeFiles, resolveAppRuntime, type AppConfigContribution, type AppRuntimePlan } from './app-runtime.js';
import { layoutContributions, layoutFilesToWatch, resolveGlobalLayout, type LayoutContribution } from './layout.js';
import { loadingContributions, loadingFilesToWatch, resolveGlobalLoading, type LoadingContribution } from './loading.js';
import { resolveGlobalStyles, styleContributions, styleFilesToWatch, type StyleContribution } from './global-style.js';
import { accessContributions, accessFilesToWatch, resolveAccessPlan, type AccessContribution } from './access.js';
import { localeCatalogSources, mergeLocaleCatalogs, readLocaleCatalogs, type LocaleCatalog, type LocaleCatalogSource } from './locale.js';
import { modelContributions, modelFiles, modelWatchPaths, resolveModels, type ModelContribution, type ModelPlan } from './model.js';
export { appRuntimePlugin, appConfigContributions, resolveAppRuntime, type AppRuntimeOptions, type AppConfigContribution, type AppRuntimePlan } from './app-runtime.js';
export { layoutPlugin, layoutContributions, resolveGlobalLayout, type LayoutPluginOptions, type LayoutContribution } from './layout.js';
export { loadingPlugin, loadingContributions, resolveGlobalLoading, type LoadingPluginOptions, type LoadingContribution } from './loading.js';
export { globalStylePlugin, styleContributions, resolveGlobalStyles, DEFAULT_STYLE_FILES, type GlobalStylePluginOptions, type StyleContribution, type GlobalStylePlan } from './global-style.js';
export { headPlugin, type HeadPluginOptions } from './head.js';
export { routePrefetchPlugin, type RoutePrefetchOptions } from './prefetch.js';
export { generatorPlugin, planGeneration, applyGeneration, type GeneratorPluginOptions, type GeneratePlan, type PlannedFile } from './generate-command.js';
export { modelPlugin, modelContributions, resolveModels, type ModelPluginOptions, type ModelContribution, type ModelPlan } from './model.js';
export { initialStatePlugin, type InitialStatePluginOptions } from './initial-state.js';
export { requestPlugin, type RequestPluginOptions } from './request.js';
export { localePlugin, localeCatalogSources, readLocaleCatalogs, mergeLocaleCatalogs, type LocalePluginOptions, type LocaleCatalog, type LocaleCatalogSource } from './locale.js';
export { accessPlugin, accessContributions, resolveAccessPlan, DEFAULT_ACCESS_FILES, type AccessPluginOptions, type AccessContribution, type AccessPlan } from './access.js';
export { menuPlugin, type MenuPluginOptions } from './menu.js';
export { clientModule } from './modules.js';
export { defineReactFeature, type ReactFeature } from './feature.js';
export { createFeatureNamespace, type FeatureNamespace } from './namespace.js';
export { routeConfigPlugin, type RouteConfigOptions } from './route-config.js';
export type { ConfigRoute, ModuleRef, RouteMeta, RouteRecord } from '@cormijs/routes';
export { generateApplication, runtimeContributions, type HistoryType, type RuntimeContribution } from './generate.js';
export { generateRouteTypes } from './types.js';

export interface ReactCompilation {
  readonly routes: OrderedHooks<readonly RouteRecord[], readonly RouteRecord[]>;
  readonly runtime: OrderedHooks<void, readonly RuntimeContribution[]>;
  readonly appConfig: OrderedHooks<void, readonly AppConfigContribution[]>;
  readonly layouts: OrderedHooks<void, readonly LayoutContribution[]>;
  readonly loading: OrderedHooks<void, readonly LoadingContribution[]>;
  readonly styles: OrderedHooks<void, readonly StyleContribution[]>;
  readonly access: OrderedHooks<void, readonly AccessContribution[]>;
  readonly locale: OrderedHooks<void, readonly LocaleCatalogSource[]>;
  readonly models: OrderedHooks<void, readonly ModelContribution[]>;
}
declare module 'cordis' { interface Context { react: ReactCompilation } }

function historyType(value: unknown): HistoryType {
  const type = typeof value === 'string' ? value
    : value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1 ? (value as { type?: unknown }).type
      : undefined;
  if (type !== 'browser' && type !== 'hash' && type !== 'memory') throw new CormiError('CONFIG_INVALID', 'app.history must be browser, hash or memory.');
  return type;
}

/** React compilation and recovery are independent of the selected development backend. */
export const reactPlugin: Plugin.Object<void> = {
  name: 'cormi:react',
  apply: ctx => {
    const routes = new OrderedHooks<readonly RouteRecord[], readonly RouteRecord[]>('routes');
    const runtime = new OrderedHooks<void, readonly RuntimeContribution[]>('runtime');
    const appConfig = new OrderedHooks<void, readonly AppConfigContribution[]>('app-config');
    const layouts = new OrderedHooks<void, readonly LayoutContribution[]>('layouts');
    const loading = new OrderedHooks<void, readonly LoadingContribution[]>('loading');
    const styles = new OrderedHooks<void, readonly StyleContribution[]>('styles');
    const access = new OrderedHooks<void, readonly AccessContribution[]>('access');
    const locale = new OrderedHooks<void, readonly LocaleCatalogSource[]>('locale-catalog');
    const models = new OrderedHooks<void, readonly ModelContribution[]>('models');
    const lifetime = new AbortController(), pending = new Set<Promise<PreparedApplication>>(), sessions = new Set<PreparedApplication>();
    ctx.provide('react', { routes, runtime, appConfig, layouts, loading, styles, access, locale, models } satisfies ReactCompilation);
    ctx.get('diagnostics')?.add('react-hooks', () => [
      ...routes.snapshot().map(({ id, owner }) => ({ kind: 'route-hook', id, declaredOwner: owner })),
      ...runtime.snapshot().map(({ id, owner }) => ({ kind: 'runtime-hook', id, declaredOwner: owner })),
      ...appConfig.snapshot().map(({ id, owner }) => ({ kind: 'app-config-hook', id, declaredOwner: owner })),
      ...layouts.snapshot().map(({ id, owner }) => ({ kind: 'layout-hook', id, declaredOwner: owner })),
      ...loading.snapshot().map(({ id, owner }) => ({ kind: 'loading-hook', id, declaredOwner: owner })),
      ...styles.snapshot().map(({ id, owner }) => ({ kind: 'style-hook', id, declaredOwner: owner })),
      ...access.snapshot().map(({ id, owner }) => ({ kind: 'access-hook', id, declaredOwner: owner })),
      ...locale.snapshot().map(({ id, owner }) => ({ kind: 'locale-catalog-hook', id, declaredOwner: owner })),
      ...models.snapshot().map(({ id, owner }) => ({ kind: 'model-hook', id, declaredOwner: owner })),
    ]);
    async function create(request: ApplicationRequest): Promise<PreparedApplication> {
      assertActive(ctx);
      const plan = createBuildPlan(request, ['pages', 'routes', 'runtime', 'runtimeConfig', 'mountId', 'strict', 'history']);
      const root = await realpath(request.root), input = request.options;
      const pages = input.pages ?? 'src/pages', mountId = input.mountId ?? 'root', developing = request.command === 'dev';
      const strict = input.strict === undefined ? false : input.strict;
      if (typeof strict !== 'boolean') throw new CormiError('CONFIG_INVALID', 'app.strict must be boolean.');
      const history = historyType(input.history === undefined ? 'browser' : input.history);
      if (typeof pages !== 'string' || typeof mountId !== 'string' || !mountId || plan.entry !== 'index.html') throw new CormiError('CONFIG_INVALID', 'Invalid React application options.');
      if (!plan.base.startsWith('/') || !plan.base.endsWith('/') || plan.base.startsWith('//') || /[?#%\\]/.test(plan.base) || plan.base.split('/').includes('..')) throw new CormiError('BASE_INVALID', 'base must be a URL path ending with /.');
      const local = new AbortController(), signal = AbortSignal.any([local.signal, request.signal, lifetime.signal]);
      signal.throwIfAborted();
      if (request.command === 'preview') return { plan, snapshot: null, async close() {} };
      const html = await readFile(join(root, 'index.html'), 'utf8');
      if (!html.includes('/.cormi/app.tsx')) throw new CormiError('GENERATED_ENTRY_MISSING', 'index.html must import /.cormi/app.tsx.');
      const entry = await AtomicEntry.open(root), typeFile = await AtomicEntry.open(root, 'routes.d.ts'), manifestFile = await AtomicEntry.open(root, 'inspect.jsonc');
      signal.throwIfAborted();
      let latestSnapshot: GeneratedInspection | undefined, lastSignature = '', lastError = '', accepted = 0;
      let polling: Promise<void> | undefined, closing: Promise<void> | undefined;
      let state: DevelopmentState = Object.freeze({ revision: 0, status: 'error', hasOutput: false,
        diagnostic: { code: 'COMPILING', phase: 'prepare', message: 'Preparing the application.', files: [] } });
      const generatedFiles = Object.freeze(['.cormi/app.tsx']);
      const listeners = new Set<(files: readonly string[]) => Promise<void>>();
      const statusListeners = new Set<(value: DevelopmentState) => Promise<void>>();
      const deliveries = new Set<Promise<void>>(), deliveryErrors: unknown[] = [];
      function deliver<T>(subscribers: Set<(value: T) => Promise<void>>, value: T, current = () => true): Promise<void> {
        if (signal.aborted) return Promise.resolve();
        const task = (async () => {
          for (const listener of [...subscribers]) {
            if (signal.aborted || !current()) break;
            if (!subscribers.has(listener)) continue;
            try { await listener(value); }
            catch (error) {
              // An observer failure is not a compilation failure, but it must fail clean shutdown.
              deliveryErrors.push(error); console.error('[cormi:diagnostic-delivery]', error);
            }
          }
        })();
        deliveries.add(task);
        task.then(() => deliveries.delete(task), () => deliveries.delete(task));
        return task;
      }

      const repairFiles = new Set<string>([pages]), anchoredFiles = new Set<string>();
      const rememberModules = (items: unknown) => {
        if (!Array.isArray(items)) return;
        for (const item of items) for (const reference of [item?.module, item?.errorBoundary]) {
          if (!reference) continue;
          try {
            const file = clientModuleFile(root, reference);
            if (!file) continue;
            const local = relative(root, file);
            if (local.startsWith('..') || isAbsolute(local)) anchoredFiles.add(file);
            else repairFiles.add(local);
          } catch { /* Compilation, not observation, reports invalid module declarations. */ }
        }
      };
      rememberModules(input.routes); rememberModules(input.runtime);
      if (input.runtimeConfig !== undefined) rememberModules([{ module: input.runtimeConfig }]);
      const baseRepairFiles = [...repairFiles], baseAnchoredFiles = [...anchoredFiles];
      const setState = async (next: Omit<DevelopmentState, 'revision'>) => {
        if (signal.aborted) return;
        const published = state = Object.freeze({ ...next, revision: state.revision + 1 });
        await deliver(statusListeners, published, () => state === published);
      };
      const queue = new RevisionQueue<{ code: string; types: string; inspection: GeneratedInspection }>(async (value, current) => {
        const valid = () => current() && !signal.aborted, first = !state.hasOutput;
        let changed: boolean;
        try {
          await typeFile.publish(value.types, valid);
          changed = await entry.publish(value.code, valid);
          await manifestFile.publish(JSON.stringify(value.inspection, null, 2) + '\n', valid);
          if (!valid()) throw new CormiError('STALE_GENERATION', 'Inputs changed before publishing diagnostics.');
        } catch (cause) {
          if (cause instanceof CormiError) throw cause;
          throw new CormiError('GENERATION_COMMIT_FAILED', 'The generated file set could not be committed.', {}, { cause });
        }
        latestSnapshot = value.inspection; lastError = '';
        await setState({ status: 'ready', hasOutput: true });
        if (changed || first) await deliver(listeners, generatedFiles);
        return changed;
      });
      const session: PreparedApplication = {
        plan, get snapshot() { return latestSnapshot; },
        typecheck: { files: ['.cormi/app.tsx', '.cormi/routes.d.ts'] },
        ...(developing ? { development: { entry: '.cormi/app.tsx', current: () => state,
          subscribe(listener: (value: DevelopmentState) => Promise<void>) {
            signal.throwIfAborted();
            const registered = (value: DevelopmentState) => listener(value);
            statusListeners.add(registered); return () => { statusListeners.delete(registered); };
          } } } : {}),
        updates: { files: generatedFiles, subscribe(listener) {
          signal.throwIfAborted();
          const registered = (files: readonly string[]) => listener(files);
          listeners.add(registered); return () => { listeners.delete(registered); };
        } },
        close() { return closing ??= (async () => {
          local.abort(); listeners.clear(); statusListeners.clear();
          try {
            await queue.close(); await polling;
            await Promise.allSettled([...deliveries]);
            if (deliveryErrors.length) throw new AggregateError(deliveryErrors, 'Development notification delivery failed');
          } finally { sessions.delete(session); }
        })(); },
      };
      sessions.add(session);
      async function observe() {
        let files: readonly string[] = [], error: unknown;
        try { files = input.routes !== undefined ? [] : await pageFiles(root, pages as string); } catch (cause) { error = cause; }
        const appRevision = appConfig.revision;
        let applicationRuntime: AppRuntimePlan = { keys: [] }, appFiles: string[] = [], layoutInputFiles: string[] = [], loadingInputFiles: string[] = [], styleInputFiles: string[] = [], accessInputFiles: string[] = [], localeFiles: string[] = [], modelInputFiles: string[] = [];
        try {
          const sources = appConfigContributions([...(input.runtimeConfig === undefined ? [] : [{ id: 'config:runtime', module: input.runtimeConfig }]), ...await appConfig.collect(undefined)]);
          appFiles = appRuntimeFiles(root, sources);
          applicationRuntime = await resolveAppRuntime(root, sources);
          layoutInputFiles = layoutFilesToWatch(layoutContributions(await layouts.collect(undefined)));
          loadingInputFiles = loadingFilesToWatch(loadingContributions(await loading.collect(undefined)));
          styleInputFiles = styleFilesToWatch(styleContributions(await styles.collect(undefined)));
          accessInputFiles = accessFilesToWatch(accessContributions(await access.collect(undefined)));
          const catalogSources = localeCatalogSources(await locale.collect(undefined));
          localeFiles = (await Promise.all(catalogSources.map(source => localeCatalogFiles(root, source)))).flat();
          const modelSources = modelContributions(await models.collect(undefined));
          modelInputFiles = [...modelWatchPaths(modelSources), ...await modelFiles(root, modelSources)];
        } catch (cause) { error ??= cause; }
        // Candidate existence is tracked even when app.ts and app.tsx currently conflict.
        const watched = new Set([...anchoredFiles, ...appFiles.filter(isAbsolute)]);
        const key = JSON.stringify([files, await repairSignature(root, [...files, ...repairFiles, ...watched, ...appFiles, ...layoutInputFiles, ...loadingInputFiles, ...styleInputFiles, ...accessInputFiles, ...localeFiles], watched), routes.revision, runtime.revision, layouts.revision, loading.revision, styles.revision, access.revision, locale.revision, models.revision, appRevision,
          error instanceof Error ? [(error as NodeJS.ErrnoException).code, error.message] : null]);
        return { files, error, key, applicationRuntime, appRevision };
      }
      async function localeCatalogFiles(root: string, source: LocaleCatalogSource): Promise<string[]> {
        const directory = source.directory;
        if (directory === undefined) return [];
        try { return (await readdir(join(root, directory))).filter(name => name.endsWith('.json')).sort().map(name => join(directory, name)); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
      }
      const compile = async (observed: Awaited<ReturnType<typeof observe>>, initial = false) => {
        const ticket = ++accepted; let phase = 'scan';
        try {
          await queue.enqueue(async cancelled => {
            const combined = AbortSignal.any([signal, cancelled]); combined.throwIfAborted();
            if (observed.error) throw observed.error;
            // Retain only current/configured references, not every page ever seen by this session.
            repairFiles.clear(); for (const file of baseRepairFiles) repairFiles.add(file);
            anchoredFiles.clear(); for (const file of baseAnchoredFiles) anchoredFiles.add(file);
            phase = 'routes';
            const routeRevision = routes.revision, runtimeRevision = runtime.revision, layoutRevision = layouts.revision, loadingRevision = loading.revision, styleRevision = styles.revision, accessRevision = access.revision, localeRevision = locale.revision, modelRevision = models.revision;
            const routeOrder = routes.snapshot(), runtimeOrder = runtime.snapshot(), layoutOrder = layouts.snapshot(), loadingOrder = loading.snapshot(), styleOrder = styles.snapshot(), accessOrder = access.snapshot(), localeOrder = locale.snapshot(), modelOrder = models.snapshot();
            const initialRoutes = input.routes !== undefined ? validateRoutes(input.routes) : routesFromFiles(observed.files, pages as string);
            const baseRoutes = validateRoutes(await routes.reduce(initialRoutes, (value): value is readonly RouteRecord[] => Array.isArray(value)));
            const layoutSources = layoutContributions(await layouts.collect(undefined));
            const globalLayout = await resolveGlobalLayout(root, layoutSources);
            if (globalLayout) rememberModules([{ module: globalLayout.module }]);
            const loadingSources = loadingContributions(await loading.collect(undefined));
            const globalLoading = await resolveGlobalLoading(root, loadingSources);
            if (globalLoading) rememberModules([{ module: globalLoading.module }]);
            const styleSources = styleContributions(await styles.collect(undefined));
            const globalStyles = await resolveGlobalStyles(root, styleSources);
            const accessPlan = await resolveAccessPlan(root, accessContributions(await access.collect(undefined)));
            if (accessPlan) rememberModules([{ module: accessPlan.module }]);
            const catalogs = await readLocaleCatalogs(root, localeCatalogSources(await locale.collect(undefined)));
            const modelSources = modelContributions(await models.collect(undefined));
            const modelPlans = await resolveModels(root, modelSources);
            rememberModules(modelPlans.map(model => ({ module: model.module })));
            const next = validateRoutes(globalLayout ? applyGlobalLayout(baseRoutes, { module: globalLayout.module, pluginId: globalLayout.owner }) : baseRoutes);
            rememberModules(next); phase = 'runtime';
            const plugins = runtimeContributions([...runtimeContributions(input.runtime ?? []), ...await runtime.collect(undefined)]);
            rememberModules(plugins); phase = 'generate';
            const code = await generateApplication(root, next, plugins, plan.base, mountId, request.serverOnlyFiles, strict, observed.applicationRuntime, globalLoading?.module, history, modelPlans, globalStyles, accessPlan?.module, catalogs);
            await transform(code, { loader: 'tsx', format: 'esm', jsx: 'automatic', logLevel: 'silent' });
            const types = generateRouteTypes(next, modelPlans.map(model => model.namespace));
            const hookInfo = (items: readonly { id: string; owner: string; stage?: number }[]) => items.map(({ id, owner, stage }) => ({ id, owner, stage: stage ?? 0 }));
            const inspection = inspectionManifest(code, types, { renderer: 'react', mode: request.mode, base: plan.base, entry: '.cormi/app.tsx', strict, history,
              routes: next.map(route => ({ ...route, ...(route.module ? { module: inspectModule(root, route.module) } : {}),
                ...(route.errorBoundary ? { errorBoundary: inspectModule(root, route.errorBoundary) } : {}) })),
              layout: globalLayout ? { owner: globalLayout.owner, module: inspectModule(root, globalLayout.module) } : null,
              loading: globalLoading ? { owner: globalLoading.owner, module: inspectModule(root, globalLoading.module) } : null,
              styles: globalStyles.map(style => ({ owner: style.owner, file: style.file })),
              access: accessPlan ? { owner: accessPlan.owner, module: inspectModule(root, accessPlan.module) } : null,
              localeCatalogs: catalogs.map(catalog => ({ locale: catalog.locale, keys: Object.keys(catalog.messages).length })),
              models: modelPlans.map(model => ({ namespace: model.namespace, module: inspectModule(root, model.module) })),
              runtime: plugins.map(({ id, module }) => ({ id, module: inspectModule(root, module) })),
              appRuntime: { ...observed.applicationRuntime, ...(observed.applicationRuntime.module ? { module: inspectModule(root, observed.applicationRuntime.module) } : {}) },
              hooks: { routes: hookInfo(routeOrder), runtime: hookInfo(runtimeOrder), layouts: hookInfo(layoutOrder), loading: hookInfo(loadingOrder), styles: hookInfo(styleOrder), access: hookInfo(accessOrder), locale: hookInfo(localeOrder), models: hookInfo(modelOrder) } });
            if (routes.revision !== routeRevision || runtime.revision !== runtimeRevision || layouts.revision !== layoutRevision || loading.revision !== loadingRevision || styles.revision !== styleRevision || access.revision !== accessRevision || locale.revision !== localeRevision || models.revision !== modelRevision || appConfig.revision !== observed.appRevision) throw new CormiError('CONTRIBUTIONS_CHANGED', 'Plugin contributions changed during compilation; this result cannot be published.');
            combined.throwIfAborted(); phase = 'commit'; return { code, types, inspection };
          });
        } catch (error) {
          if (!developing || initial && !recoverable(error)) throw error;
          if (ticket !== accepted || signal.aborted) return;
          await setState({ status: 'error', hasOutput: !!latestSnapshot, diagnostic: developmentDiagnostic(error, phase, root) });
          const message = error instanceof Error ? error.message : String(error);
          if (message !== lastError) { lastError = message; console.error(`[cormi:generate] ${message}`); }
        }
      };
      try {
        const initial = await observe(); lastSignature = initial.key;
        await compile(initial, true); signal.throwIfAborted();
        if (developing) polling = (async () => {
          while (!signal.aborted) {
            await delay(150, undefined, { signal }).catch(() => {});
            if (signal.aborted) break;
            const observed = await observe();
            if (signal.aborted || observed.key === lastSignature) continue;
            lastSignature = observed.key;
            void compile(observed).catch(error => { if (!signal.aborted) console.error('[cormi:diagnostic-delivery]', error); });
          }
        })();
        return session;
      } catch (error) { await session.close(); throw error; }
    }
    ctx.provide('application', { prepare(request: ApplicationRequest) {
      const task = create(request); pending.add(task);
      task.then(() => pending.delete(task), () => pending.delete(task)); return task;
    } });
    ctx.effect(() => async () => {
      lifetime.abort(); await Promise.allSettled([...pending]);
      const results = await Promise.allSettled([...sessions].map(session => session.close()));
      const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (errors.length) throw new AggregateError(errors.map(r => r.reason), 'React compilation cleanup failed');
    });
  },
};
