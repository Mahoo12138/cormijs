import { assertActive, CormiError, type Plugin, type RuntimePluginDescriptor } from '@cormijs/core';
import type { DevelopmentState } from '@cormijs/builder';
import { AtomicEntry, RevisionQueue, OrderedHooks, createBuildPlan, type ApplicationRequest, type PreparedApplication, type GeneratedInspection } from '@cormijs/plugin-web';
import { type RouteRecord } from '@cormijs/routes';
import { realpath, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { type HistoryType } from './generate.js';
import { developmentDiagnostic, recoverable } from './development.js';
import { clientModuleFile } from './modules.js';
import { type AppConfigContribution } from './app-runtime.js';
import { type LayoutContribution } from './layout.js';
import { type LoadingContribution } from './loading.js';
import { type StyleContribution } from './global-style.js';
import { type AccessContribution } from './access.js';
import { type LocaleCatalogSource } from './locale.js';
import { type ModelContribution } from './model.js';
import { createObserveFn, runCompilation, type CompilePhase } from './compilation.js';
import { registerAppConfigSchemas, validateAppConfig } from './app-config-schema.js';
export { appRuntimePlugin, appConfigContributions, resolveAppRuntime, type AppRuntimeOptions, type AppConfigContribution, type AppRuntimePlan } from './app-runtime.js';
export { layoutPlugin, layoutContributions, resolveGlobalLayout, type LayoutPluginOptions, type LayoutContribution } from './layout.js';
export { loadingPlugin, loadingContributions, resolveGlobalLoading, type LoadingPluginOptions, type LoadingContribution } from './loading.js';
export { globalStylePlugin, styleContributions, resolveGlobalStyles, DEFAULT_STYLE_FILES, type GlobalStylePluginOptions, type StyleContribution, type GlobalStylePlan } from './global-style.js';
export { headPlugin, type HeadPluginOptions } from './head.js';
export { routePrefetchPlugin, type RoutePrefetchOptions } from './prefetch.js';
export { analyticsPlugin, type AnalyticsPluginOptions } from './analytics.js';
export { toolPlugin, runTool, type ToolPluginOptions, type ToolSpec } from './tools.js';
export { detectClientLoader, detectServerLoader, pageLoaders, pageServerLoaders, pageLoaderExports, CLIENT_LOADER_EXPORT, SERVER_LOADER_EXPORT, type PageLoaderExports } from './page-loaders.js';
export { generateLoaderTypes, type LoaderTypeEntry } from './loaders.js';
export { generateStyleTypes, styleTypesPlugin, type StyleTypesPluginOptions } from './style-types.js';
export { generatorPlugin, planGeneration, normalizeTemplates, applyGeneration, type GeneratorPluginOptions, type GeneratePlan, type GenerateTemplate, type PlannedFile } from './generate-command.js';
export { modelPlugin, modelContributions, resolveModels, type ModelPluginOptions, type ModelContribution, type ModelPlan } from './model.js';
export { initialStatePlugin, type InitialStatePluginOptions } from './initial-state.js';
export { requestPlugin, type RequestPluginOptions } from './request.js';
export { localePlugin, localeCatalogSources, readLocaleCatalogs, mergeLocaleCatalogs, generateLocaleTypes, type LocalePluginOptions, type LocaleCatalog, type LocaleCatalogSource } from './locale.js';
export { accessPlugin, accessContributions, resolveAccessPlan, DEFAULT_ACCESS_FILES, type AccessPluginOptions, type AccessContribution, type AccessPlan } from './access.js';
export { menuPlugin, type MenuPluginOptions } from './menu.js';
export { clientModule } from './modules.js';
export { isServerModule } from './modules.js';
export { defineReactFeature, type ReactFeature } from './feature.js';
export { createFeatureNamespace, type FeatureNamespace } from './namespace.js';
export { routeConfigPlugin, type RouteConfigOptions } from './route-config.js';
export type { ConfigRoute, ModuleRef, RouteMeta, RouteRecord } from '@cormijs/routes';
export { generateApplication, runtimeContributions, type HistoryType, type RuntimeContribution } from './generate.js';
export { generateRouteTypes } from './types.js';
export { AllReactAppSchemas, ReactAppConfigSchema, LocaleAppConfigSchema, ModelAppConfigSchema,
  InitialStateAppConfigSchema, RequestAppConfigSchema, AccessAppConfigSchema, MenuAppConfigSchema,
  HeadAppConfigSchema, AnalyticsAppConfigSchema, PrefetchAppConfigSchema, GlobalStyleAppConfigSchema,
  HtmlAppConfigSchema, ServerAppConfigSchema, registerAppConfigSchemas, validateAppConfig } from './app-config-schema.js';
export { type ObservationResult, type CompilationOutput, type CompilePhase } from './compilation.js';
export { buildApplicationManifest } from './manifest-builder.js';
export { LocaleCompilationService, ModelCompilationService, RuntimeCompilationService, RouteCompilationService } from './services/index.js';
import { LocaleCompilationService, ModelCompilationService, RuntimeCompilationService, RouteCompilationService } from './services/index.js';

export interface ReactCompilation {
  readonly routes: OrderedHooks<readonly RouteRecord[], readonly RouteRecord[]>;
  readonly runtime: OrderedHooks<void, readonly RuntimePluginDescriptor[]>;
  readonly appConfig: OrderedHooks<void, readonly AppConfigContribution[]>;
  readonly layouts: OrderedHooks<void, readonly LayoutContribution[]>;
  readonly loading: OrderedHooks<void, readonly LoadingContribution[]>;
  readonly styles: OrderedHooks<void, readonly StyleContribution[]>;
  readonly access: OrderedHooks<void, readonly AccessContribution[]>;
  readonly locale: OrderedHooks<void, readonly LocaleCatalogSource[]>;
  readonly models: OrderedHooks<void, readonly ModelContribution[]>;
  // styleTypes is a presence flag only; the boolean values are never read, only snapshot().length
  // is checked to determine whether to emit CSS/asset ambient declarations.
  readonly styleTypes: OrderedHooks<void, readonly boolean[]>;
  /** Dev-only: subscribe to the latest inspection manifest after each successful compilation. */
  readonly onManifest?: (listener: (manifest: GeneratedInspection) => void) => () => void;
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
    // Initialize domain services first (they register themselves on the context)
    ctx.plugin(RouteCompilationService);
    ctx.plugin(RuntimeCompilationService);
    ctx.plugin(LocaleCompilationService);
    ctx.plugin(ModelCompilationService);

    // Legacy hooks for backward compatibility (new code should use domain services)
    const appConfig = new OrderedHooks<void, readonly AppConfigContribution[]>('app-config');
    const layouts = new OrderedHooks<void, readonly LayoutContribution[]>('layouts');
    const loading = new OrderedHooks<void, readonly LoadingContribution[]>('loading');
    const styles = new OrderedHooks<void, readonly StyleContribution[]>('styles');
    const access = new OrderedHooks<void, readonly AccessContribution[]>('access');
    const styleTypes = new OrderedHooks<void, readonly boolean[]>('style-types');
    const lifetime = new AbortController(), pending = new Set<Promise<PreparedApplication>>(), sessions = new Set<PreparedApplication>();

    // Manifest listeners for dev-only tooling
    const manifestListeners = new Set<(manifest: GeneratedInspection) => void>();
    const onManifest = (listener: (manifest: GeneratedInspection) => void) => {
      manifestListeners.add(listener);
      return () => manifestListeners.delete(listener);
    };

    // Provide ReactCompilation surface with lazy getters for service access
    // Services are accessed on-demand when hooks are actually used
    const react: ReactCompilation = {
      // Aliases to domain services (lazy getters ensure services are ready when accessed)
      get routes() { return ctx['route-compiler'].routes; },
      get runtime() { return ctx['runtime-compiler'].plugins; },
      get locale() { return ctx['locale-compiler'].catalog; },
      get models() { return ctx['model-compiler'].contributions; },
      // Legacy hooks (not yet migrated to domain services)
      appConfig,
      layouts,
      loading,
      styles,
      access,
      styleTypes,
      onManifest,
    };
    ctx.provide('react', react);

    // Register app config schemas if SchemaService is available
    ctx.effect(() => {
      const svc = ctx.get('schema');
      if (svc) registerAppConfigSchemas(svc);
      return () => {}; // Schemas are permanent, no cleanup needed
    });

    ctx.get('diagnostics')?.add('react-hooks', () => [
      ...ctx.react.routes.snapshot().map(({ id, owner }) => ({ kind: 'route-hook', id, declaredOwner: owner })),
      ...ctx.react.runtime.snapshot().map(({ id, owner }) => ({ kind: 'runtime-hook', id, declaredOwner: owner })),
      ...ctx.react.appConfig.snapshot().map(({ id, owner }) => ({ kind: 'app-config-hook', id, declaredOwner: owner })),
      ...ctx.react.layouts.snapshot().map(({ id, owner }) => ({ kind: 'layout-hook', id, declaredOwner: owner })),
      ...ctx.react.loading.snapshot().map(({ id, owner }) => ({ kind: 'loading-hook', id, declaredOwner: owner })),
      ...ctx.react.styles.snapshot().map(({ id, owner }) => ({ kind: 'style-hook', id, declaredOwner: owner })),
      ...ctx.react.access.snapshot().map(({ id, owner }) => ({ kind: 'access-hook', id, declaredOwner: owner })),
      ...ctx.react.locale.snapshot().map(({ id, owner }) => ({ kind: 'locale-catalog-hook', id, declaredOwner: owner })),
      ...ctx.react.models.snapshot().map(({ id, owner }) => ({ kind: 'model-hook', id, declaredOwner: owner })),
    ]);
    async function create(request: ApplicationRequest): Promise<PreparedApplication> {
      assertActive(ctx);
      const plan = createBuildPlan(request, ['pages', 'routes', 'runtime', 'runtimeConfig', 'mountId', 'strict', 'history', 'ssr']);
      const root = await realpath(request.root), input = request.options;

      // Validate app config against registered schemas
      validateAppConfig(input, ctx.get('schema'));

      const pages = input.pages ?? 'src/pages', mountId = input.mountId ?? 'root', developing = request.command === 'dev';
      const strict = input.strict === undefined ? false : input.strict;
      if (typeof strict !== 'boolean') throw new CormiError('CONFIG_INVALID', 'app.strict must be boolean.');
      const history = historyType(input.history === undefined ? 'browser' : input.history);
      if (typeof pages !== 'string' || typeof mountId !== 'string' || !mountId || plan.entry !== 'index.html') throw new CormiError('CONFIG_INVALID', 'Invalid React application options.');
      if (input.ssr !== undefined && typeof input.ssr !== 'boolean') throw new CormiError('CONFIG_INVALID', 'app.ssr must be boolean.');
      if (!plan.base.startsWith('/') || !plan.base.endsWith('/') || plan.base.startsWith('//') || /[?#%\\]/.test(plan.base) || plan.base.split('/').includes('..')) throw new CormiError('BASE_INVALID', 'base must be a URL path ending with /.');
      const local = new AbortController(), signal = AbortSignal.any([local.signal, request.signal, lifetime.signal]);
      signal.throwIfAborted();
      if (request.command === 'preview') return { plan, snapshot: null, async close() {} };
      const html = await readFile(join(root, 'index.html'), 'utf8');
      if (!html.includes('/.cormi/app.tsx')) throw new CormiError('GENERATED_ENTRY_MISSING', 'index.html must import /.cormi/app.tsx.');
      const entry = await AtomicEntry.open(root), typeFile = await AtomicEntry.open(root, 'routes.d.ts'), localeTypesFile = await AtomicEntry.open(root, 'locale.d.ts'), loaderTypesFile = await AtomicEntry.open(root, 'loaders.d.ts'), styleTypesFile = await AtomicEntry.open(root, 'styles.d.ts'), serverLoadersFile = await AtomicEntry.open(root, 'server-loaders.tsx'), manifestFile = await AtomicEntry.open(root, 'inspect.jsonc'), appManifestFile = await AtomicEntry.open(root, 'manifest.json');
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

      // Create the observation function using the extracted compilation pipeline
      const observe = createObserveFn({
        root,
        pages: pages as string,
        input,
        repairFiles,
        anchoredFiles,
        react: ctx.react
      });

      const setState = async (next: Omit<DevelopmentState, 'revision'>) => {
        if (signal.aborted) return;
        const published = state = Object.freeze({ ...next, revision: state.revision + 1 });
        await deliver(statusListeners, published, () => state === published);
      };
      const queue = new RevisionQueue<{ code: string; types: string; localeTypes: string; loaderTypes: string; styleTypes: string; serverLoaders: string; inspection: GeneratedInspection; manifest: string }>(async (value, current) => {
        const valid = () => current() && !signal.aborted, first = !state.hasOutput;
        let changed: boolean;
        try {
          await typeFile.publish(value.types, valid);
          await localeTypesFile.publish(value.localeTypes, valid);
          await loaderTypesFile.publish(value.loaderTypes, valid);
          await styleTypesFile.publish(value.styleTypes, valid);
          await serverLoadersFile.publish(value.serverLoaders, valid);
          changed = await entry.publish(value.code, valid);
          await manifestFile.publish(JSON.stringify(value.inspection, null, 2) + '\n', valid);
          await appManifestFile.publish(value.manifest, valid);
          if (!valid()) throw new CormiError('STALE_GENERATION', 'Inputs changed before publishing diagnostics.');
        } catch (cause) {
          if (cause instanceof CormiError) throw cause;
          throw new CormiError('GENERATION_COMMIT_FAILED', 'The generated file set could not be committed.', {}, { cause });
        }
        latestSnapshot = value.inspection; lastError = '';
        await setState({ status: 'ready', hasOutput: true });
        if (changed || first) await deliver(listeners, generatedFiles);
        // Notify manifest listeners after successful publication
        for (const fn of manifestListeners) {
          try { fn(value.inspection); } catch { /* Listener errors don't affect compilation */ }
        }
        return changed;
      });
      const session: PreparedApplication = {
        plan, get snapshot() { return latestSnapshot; },
        typecheck: { files: ['.cormi/app.tsx', '.cormi/routes.d.ts', '.cormi/locale.d.ts', '.cormi/loaders.d.ts', '.cormi/styles.d.ts', '.cormi/server-loaders.tsx'] },
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

      const compile = async (observed: Awaited<ReturnType<typeof observe>>, initial = false) => {
        const ticket = ++accepted;
        let phase: CompilePhase = 'scan';
        try {
          await queue.enqueue(async cancelled => {
            const combined = AbortSignal.any([signal, cancelled]);
            combined.throwIfAborted();

            // Retain only current/configured references
            repairFiles.clear();
            for (const file of baseRepairFiles) repairFiles.add(file);
            anchoredFiles.clear();
            for (const file of baseAnchoredFiles) anchoredFiles.add(file);

            phase = 'routes';
            const result = await runCompilation({
              observed,
              root,
              pages: pages as string,
              input,
              base: plan.base,
              mountId,
              strict,
              history,
              ssr: input.ssr === true,
              serverOnlyFiles: request.serverOnlyFiles ?? [],
              rememberModules,
              react: ctx.react
            });

            combined.throwIfAborted();
            phase = 'commit';
            return result;
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
            // 150ms balances responsiveness against redundant I/O: observe() does readdir/stat
            // on every tick, and signature comparison prevents recompilation when nothing changed.
            // A longer interval would delay dev feedback; a shorter one would waste I/O on large trees.
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
