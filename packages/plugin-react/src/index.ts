import { assertActive, CormiError, type Plugin } from '@cormijs/core';
import { AtomicEntry, RevisionQueue, OrderedHooks, createBuildPlan, inspectionManifest, type ApplicationRequest, type PreparedApplication, type GeneratedInspection } from '@cormijs/plugin-web';
import { pageFiles, routesFromFiles, validateRoutes, type RouteRecord } from '@cormijs/routes';
import { realpath, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { transform } from 'esbuild';
import { generateApplication, runtimeContributions, type RuntimeContribution } from './generate.js';
export { generateApplication, runtimeContributions, type RuntimeContribution } from './generate.js';
import { generateRouteTypes } from './types.js';
export { generateRouteTypes } from './types.js';

export interface ReactCompilation {
  readonly routes: OrderedHooks<readonly RouteRecord[], readonly RouteRecord[]>;
  readonly runtime: OrderedHooks<void, readonly RuntimeContribution[]>;
}
declare module 'cordis' { interface Context { react: ReactCompilation } }

/** React-specific compilation is a Cordis provider, independent of any bundler implementation. */
export const reactPlugin: Plugin.Object<void> = {
  name: 'cormi:react',
  apply: ctx => {
    const routes = new OrderedHooks<readonly RouteRecord[], readonly RouteRecord[]>('routes');
    const runtime = new OrderedHooks<void, readonly RuntimeContribution[]>('runtime');
    const lifetime = new AbortController();
    const pending = new Set<Promise<PreparedApplication>>();
    const sessions = new Set<PreparedApplication>();
    ctx.provide('react', { routes, runtime } satisfies ReactCompilation);

    async function create(request: ApplicationRequest): Promise<PreparedApplication> {
      assertActive(ctx);
      const plan = createBuildPlan(request, ['pages', 'routes', 'runtime', 'mountId']);
      const root = await realpath(request.root), input = request.options;
      const pages = input.pages ?? 'src/pages', mountId = input.mountId ?? 'root';
      if (typeof pages !== 'string' || typeof mountId !== 'string' || !mountId || plan.entry !== 'index.html') throw new CormiError('CONFIG_INVALID', 'Invalid React application options.');
      if (!plan.base.startsWith('/') || !plan.base.endsWith('/') || plan.base.startsWith('//') || /[?#%\\]/.test(plan.base) || plan.base.split('/').includes('..')) throw new CormiError('BASE_INVALID', 'base must be a URL path ending with /.');
      const local = new AbortController(), signal = AbortSignal.any([local.signal, request.signal, lifetime.signal]);
      signal.throwIfAborted();
      if (request.command === 'preview') return { plan, snapshot: null, async close() {} };
      const html = await readFile(join(root, 'index.html'), 'utf8');
      if (!html.includes('/.cormi/app.tsx')) throw new CormiError('GENERATED_ENTRY_MISSING', 'index.html must import /.cormi/app.tsx.');
      const entry = await AtomicEntry.open(root); signal.throwIfAborted();
      const typeFile = await AtomicEntry.open(root, 'routes.d.ts'), manifestFile = await AtomicEntry.open(root, 'inspect.jsonc');
      let latestSnapshot: GeneratedInspection | undefined, lastSignature = '', lastError = '';
      let polling: Promise<void> | undefined, closing: Promise<void> | undefined;
      const generatedFiles = Object.freeze(['.cormi/app.tsx']);
      const listeners = new Set<(files: readonly string[]) => Promise<void>>();
      const queue = new RevisionQueue<{ code: string; types: string; inspection: GeneratedInspection }>(async (value, current) => {
        const valid = () => current() && !signal.aborted;
        await typeFile.publish(value.types, valid);
        const changed = await entry.publish(value.code, valid);
        await manifestFile.publish(JSON.stringify(value.inspection, null, 2) + '\n', valid);
        latestSnapshot = value.inspection;
        if (changed) for (const listener of [...listeners]) await listener(generatedFiles);
        return changed;
      });
      const session: PreparedApplication = {
        plan, get snapshot() { return latestSnapshot; },
        typecheck: { files: ['.cormi/app.tsx', '.cormi/routes.d.ts'] },
        updates: { files: generatedFiles, subscribe(listener) {
          signal.throwIfAborted(); listeners.add(listener);
          return () => { listeners.delete(listener); };
        } },
        close() {
          return closing ??= (async () => {
            local.abort(); listeners.clear();
            try { await queue.close(); await polling; } finally { sessions.delete(session); }
          })();
        },
      };
      sessions.add(session);
      const collectFiles = () => input.routes !== undefined ? Promise.resolve([] as readonly string[]) : pageFiles(root, pages);
      const signature = (files: readonly string[]) => JSON.stringify([files, routes.revision, runtime.revision]);
      const compile = (files: readonly string[]) => queue.enqueue(async cancelled => {
        const combined = AbortSignal.any([signal, cancelled]); combined.throwIfAborted();
        const routeRevision = routes.revision, runtimeRevision = runtime.revision;
        const routeOrder = routes.snapshot(), runtimeOrder = runtime.snapshot();
        const initial = input.routes !== undefined ? validateRoutes(input.routes) : routesFromFiles(files, pages);
        const next = validateRoutes(await routes.reduce(initial, (value): value is readonly RouteRecord[] => Array.isArray(value)));
        const plugins = runtimeContributions([...(runtimeContributions(input.runtime ?? [])), ...await runtime.collect(undefined)]);
        const code = await generateApplication(root, next, plugins, plan.base, mountId, request.serverOnlyFiles);
        await transform(code, { loader: 'tsx', format: 'esm', jsx: 'automatic', logLevel: 'silent' });
        const types = generateRouteTypes(next);
        const hookInfo = (items: readonly { id: string; owner: string; stage?: number }[]) => items.map(({ id, owner, stage }) => ({ id, owner, stage: stage ?? 0 }));
        const inspection = inspectionManifest(code, types, {
          renderer: 'react', mode: request.mode, base: plan.base, entry: '.cormi/app.tsx',
          routes: next, runtime: plugins.map(({ id, module }) => ({ id, module })),
          hooks: { routes: hookInfo(routeOrder), runtime: hookInfo(runtimeOrder) },
        });
        if (routes.revision !== routeRevision || runtime.revision !== runtimeRevision) {
          throw new CormiError('CONTRIBUTIONS_CHANGED', 'Plugin contributions changed during compilation; this result cannot be published.');
        }
        combined.throwIfAborted(); return { code, types, inspection };
      });
      const report = (error: unknown) => {
        if (signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastError) { lastError = message; console.error(`[cormi:generate] ${message}`); }
      };
      try {
        const initialFiles = await collectFiles(); lastSignature = signature(initialFiles);
        await compile(initialFiles); signal.throwIfAborted();
        if (request.command === 'dev') polling = (async () => {
          while (!signal.aborted) {
            await delay(150, undefined, { signal }).catch(() => {});
            if (signal.aborted) break;
            try {
              const files = await collectFiles(), key = signature(files);
              if (key === lastSignature) continue;
              lastSignature = key;
              void compile(files).then(() => { lastError = ''; }, report);
            } catch (error) { report(error); }
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
