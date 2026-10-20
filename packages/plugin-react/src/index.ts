import { assertActive, CormiError, type Plugin } from '@cormijs/core';
import type { DevelopmentState } from '@cormijs/builder';
import { AtomicEntry, RevisionQueue, OrderedHooks, createBuildPlan, inspectionManifest, type ApplicationRequest, type PreparedApplication, type GeneratedInspection } from '@cormijs/plugin-web';
import { pageFiles, routesFromFiles, validateRoutes, type RouteRecord } from '@cormijs/routes';
import { realpath, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { transform } from 'esbuild';
import { generateApplication, runtimeContributions, type RuntimeContribution } from './generate.js';
import { generateRouteTypes } from './types.js';
import { developmentDiagnostic, recoverable, repairSignature } from './development.js';
import { clientModuleFile, inspectModule } from './modules.js';
import { appConfigContributions, appRuntimeFiles, resolveAppRuntime, type AppConfigContribution, type AppRuntimePlan } from './app-runtime.js';
export { appRuntimePlugin, appConfigContributions, resolveAppRuntime, type AppRuntimeOptions, type AppConfigContribution, type AppRuntimePlan } from './app-runtime.js';
export { clientModule } from './modules.js';
export { defineReactFeature, type ReactFeature } from './feature.js';
export { createFeatureNamespace, type FeatureNamespace } from './namespace.js';
export { routeConfigPlugin, type RouteConfigOptions } from './route-config.js';
export type { ConfigRoute, ModuleRef, RouteMeta, RouteRecord } from '@cormijs/routes';
export { generateApplication, runtimeContributions, type RuntimeContribution } from './generate.js';
export { generateRouteTypes } from './types.js';

export interface ReactCompilation {
  readonly routes: OrderedHooks<readonly RouteRecord[], readonly RouteRecord[]>;
  readonly runtime: OrderedHooks<void, readonly RuntimeContribution[]>;
  readonly appConfig: OrderedHooks<void, readonly AppConfigContribution[]>;
}
declare module 'cordis' { interface Context { react: ReactCompilation } }

/** React compilation and recovery are independent of the selected development backend. */
export const reactPlugin: Plugin.Object<void> = {
  name: 'cormi:react',
  apply: ctx => {
    const routes = new OrderedHooks<readonly RouteRecord[], readonly RouteRecord[]>('routes');
    const runtime = new OrderedHooks<void, readonly RuntimeContribution[]>('runtime');
    const appConfig = new OrderedHooks<void, readonly AppConfigContribution[]>('app-config');
    const lifetime = new AbortController(), pending = new Set<Promise<PreparedApplication>>(), sessions = new Set<PreparedApplication>();
    ctx.provide('react', { routes, runtime, appConfig } satisfies ReactCompilation);
    ctx.get('diagnostics')?.add('react-hooks', () => [
      ...routes.snapshot().map(({ id, owner }) => ({ kind: 'route-hook', id, declaredOwner: owner })),
      ...runtime.snapshot().map(({ id, owner }) => ({ kind: 'runtime-hook', id, declaredOwner: owner })),
      ...appConfig.snapshot().map(({ id, owner }) => ({ kind: 'app-config-hook', id, declaredOwner: owner })),
    ]);
    async function create(request: ApplicationRequest): Promise<PreparedApplication> {
      assertActive(ctx);
      const plan = createBuildPlan(request, ['pages', 'routes', 'runtime', 'runtimeConfig', 'mountId', 'strict']);
      const root = await realpath(request.root), input = request.options;
      const pages = input.pages ?? 'src/pages', mountId = input.mountId ?? 'root', developing = request.command === 'dev';
      const strict = input.strict === undefined ? false : input.strict;
      if (typeof strict !== 'boolean') throw new CormiError('CONFIG_INVALID', 'app.strict must be boolean.');
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
        let applicationRuntime: AppRuntimePlan = { keys: [] }, appFiles: string[] = [];
        try {
          const sources = appConfigContributions([...(input.runtimeConfig === undefined ? [] : [{ id: 'config:runtime', module: input.runtimeConfig }]), ...await appConfig.collect(undefined)]);
          appFiles = appRuntimeFiles(root, sources);
          applicationRuntime = await resolveAppRuntime(root, sources);
        } catch (cause) { error ??= cause; }
        // Candidate existence is tracked even when app.ts and app.tsx currently conflict.
        const watched = new Set([...anchoredFiles, ...appFiles.filter(isAbsolute)]);
        const key = JSON.stringify([files, await repairSignature(root, [...files, ...repairFiles, ...watched, ...appFiles], watched), routes.revision, runtime.revision, appRevision,
          error instanceof Error ? [(error as NodeJS.ErrnoException).code, error.message] : null]);
        return { files, error, key, applicationRuntime, appRevision };
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
            const routeRevision = routes.revision, runtimeRevision = runtime.revision;
            const routeOrder = routes.snapshot(), runtimeOrder = runtime.snapshot();
            const initialRoutes = input.routes !== undefined ? validateRoutes(input.routes) : routesFromFiles(observed.files, pages as string);
            const next = validateRoutes(await routes.reduce(initialRoutes, (value): value is readonly RouteRecord[] => Array.isArray(value)));
            rememberModules(next); phase = 'runtime';
            const plugins = runtimeContributions([...runtimeContributions(input.runtime ?? []), ...await runtime.collect(undefined)]);
            rememberModules(plugins); phase = 'generate';
            const code = await generateApplication(root, next, plugins, plan.base, mountId, request.serverOnlyFiles, strict, observed.applicationRuntime);
            await transform(code, { loader: 'tsx', format: 'esm', jsx: 'automatic', logLevel: 'silent' });
            const types = generateRouteTypes(next);
            const hookInfo = (items: readonly { id: string; owner: string; stage?: number }[]) => items.map(({ id, owner, stage }) => ({ id, owner, stage: stage ?? 0 }));
            const inspection = inspectionManifest(code, types, { renderer: 'react', mode: request.mode, base: plan.base, entry: '.cormi/app.tsx', strict,
              routes: next.map(route => ({ ...route, ...(route.module ? { module: inspectModule(root, route.module) } : {}),
                ...(route.errorBoundary ? { errorBoundary: inspectModule(root, route.errorBoundary) } : {}) })),
              runtime: plugins.map(({ id, module }) => ({ id, module: inspectModule(root, module) })),
              appRuntime: { ...observed.applicationRuntime, ...(observed.applicationRuntime.module ? { module: inspectModule(root, observed.applicationRuntime.module) } : {}) },
              hooks: { routes: hookInfo(routeOrder), runtime: hookInfo(runtimeOrder) } });
            if (routes.revision !== routeRevision || runtime.revision !== runtimeRevision || appConfig.revision !== observed.appRevision) throw new CormiError('CONTRIBUTIONS_CHANGED', 'Plugin contributions changed during compilation; this result cannot be published.');
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
