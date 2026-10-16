import { assertActive, CormiError, type Context, type Plugin } from '@cormijs/core';
import type { Builder, BuildPlan, BuildResult, ServerHandle } from '@cormijs/builder';
export { OrderedHooks } from './ordered-hooks.js';
export { webCommandsPlugin, plan as createBuildPlan } from './commands.js';
export { applicationCommandsPlugin, type ApplicationCompiler, type ApplicationRequest, type PreparedApplication } from './application.js';
export { AtomicEntry, RevisionQueue, GENERATED_HEADER, type GenerationResult } from './generation.js';
export { readInspection, inspectionManifest, inspectionPlugin, type GeneratedInspection } from './inspection.js';

export interface WebApplication {
  dev(plan: BuildPlan, signal?: AbortSignal): Promise<ServerHandle>;
  build(plan: BuildPlan, signal?: AbortSignal): Promise<BuildResult>;
  preview(plan: BuildPlan, signal?: AbortSignal): Promise<ServerHandle>;
}

declare module 'cordis' {
  interface Context { web: WebApplication }
}

/** Raw backend sessions; command plugins add preparation and managed publication policy. */
export const webPlugin: Plugin.Object<void> = {
  name: 'cormi:web',
  inject: ['builder'],
  apply: (ctx: Context) => {
    const builder: Builder = ctx.builder;
    const lifetime = new AbortController();
    const pending = new Set<Promise<unknown>>();
    const sessions = new Set<ServerHandle>();
    const cleanupErrors: unknown[] = [];

    async function launch<T>(operation: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal,
      acquire?: (value: T) => ServerHandle): Promise<T> {
      assertActive(ctx);
      if (lifetime.signal.aborted) throw new CormiError('PLUGIN_INACTIVE', 'Web application is closing.');
      const combined = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
      const task = (async () => {
        combined.throwIfAborted();
        const value = await operation(combined);
        if (acquire) {
          const handle = acquire(value);
          sessions.add(handle);
          if (combined.aborted) {
            try { await handle.close(); } catch (error) { cleanupErrors.push(error); }
            sessions.delete(handle);
          }
        }
        combined.throwIfAborted();
        return value;
      })();
      pending.add(task);
      task.then(() => pending.delete(task), () => pending.delete(task));
      return task;
    }

    function own(handle: ServerHandle): ServerHandle {
      let closing: Promise<void> | undefined;
      const wrapped: ServerHandle = Object.freeze({
        url: handle.url,
        ...(handle.invalidate ? { async invalidate(files: readonly string[]) {
          if (closing) throw new CormiError('SERVER_CLOSED', 'Web session is closing.');
          await handle.invalidate!(files);
        } } : {}),
        close() {
          if (closing) return closing;
          closing = Promise.resolve().then(() => handle.close()).finally(() => sessions.delete(wrapped));
          closing.catch(error => { cleanupErrors.push(error); });
          return closing;
        },
      });
      return wrapped;
    }

    ctx.provide('web', {
      dev: (plan: BuildPlan, signal?: AbortSignal) => launch(s => builder.dev(plan, s).then(own), signal, value => value),
      build: (plan: BuildPlan, signal?: AbortSignal) => launch(s => builder.build(plan, s), signal),
      preview: (plan: BuildPlan, signal?: AbortSignal) => launch(s => builder.preview(plan, s).then(own), signal, value => value),
    } satisfies WebApplication);
    ctx.effect(() => async () => {
      lifetime.abort(new CormiError('PLUGIN_INACTIVE', 'Web application was unloaded.'));
      await Promise.allSettled([...pending]);
      const results = await Promise.allSettled([...sessions].map(handle => handle.close()));
      sessions.clear();
      for (const result of results) if (result.status === 'rejected') cleanupErrors.push(result.reason);
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Web sessions did not close cleanly');
    });
  },
};
