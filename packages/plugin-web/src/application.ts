import { assertActive, CormiError, type CommandRequest, type CommandResult, type Plugin } from '@cormijs/core';
import type { BuildPlan, ServerHandle } from '@cormijs/builder';
import type {} from './index.js';

export interface PreparedApplication {
  readonly plan: BuildPlan;
  readonly snapshot: unknown;
  readonly updates?: {
    readonly files: readonly string[];
    subscribe(listener: (files: readonly string[]) => Promise<void>): () => void;
  };
  close(): Promise<void>;
}
export interface ApplicationRequest extends CommandRequest { readonly command: 'dev' | 'build' | 'preview' | 'prepare' }
export interface ApplicationCompiler { prepare(request: ApplicationRequest): Promise<PreparedApplication> }
declare module 'cordis' { interface Context { application: ApplicationCompiler } }

/** This policy consumes a renderer-neutral compiler and builder. No React/Vite imports. */
export const applicationCommandsPlugin: Plugin.Object<void> = {
  name: 'cormi:application-commands', inject: ['commands', 'web', 'application'],
  apply: ctx => {
    const application = ctx.application, web = ctx.web, lifetime = new AbortController();
    const sessions = new Set<ServerHandle>(), pending = new Set<Promise<CommandResult>>();
    const cleanupErrors: unknown[] = [];
    async function execute(command: ApplicationRequest['command'], original: CommandRequest): Promise<CommandResult> {
      assertActive(ctx);
      const request = { ...original, signal: AbortSignal.any([original.signal, lifetime.signal]) };
      request.signal.throwIfAborted();
      const prepared = await application.prepare({ ...request, command });
      let server: ServerHandle | undefined, unsubscribe: (() => void) | undefined;
      try {
        request.signal.throwIfAborted();
        if (command === 'prepare') { await prepared.close(); return { kind: 'result', data: prepared.snapshot }; }
        if (command === 'build') {
          const result = await web.build(prepared.plan, request.signal);
          await prepared.close(); request.signal.throwIfAborted(); return { kind: 'result', data: result };
        }
        server = command === 'dev' ? await web.dev(prepared.plan, request.signal) : await web.preview(prepared.plan, request.signal);
        const native = server;
        if (command === 'dev' && prepared.updates) {
          if (!native.invalidate) throw new CormiError('BUILDER_INVALIDATION_UNSUPPORTED', 'Generated applications need a backend with development invalidation.');
          unsubscribe = prepared.updates.subscribe(files => native.invalidate!(files));
          // Reconcile changes committed while the development backend was starting.
          await native.invalidate(prepared.updates.files);
        }
        request.signal.throwIfAborted();
        let closing: Promise<void> | undefined;
        const handle: ServerHandle = { url: native.url, close() {
          if (closing) return closing;
          closing = (async () => {
            unsubscribe?.();
            try { await prepared.close(); } finally { try { await native.close(); } finally { sessions.delete(handle); } }
          })();
          closing.catch(error => { cleanupErrors.push(error); }); return closing;
        } };
        sessions.add(handle); return { kind: 'server', handle };
      } catch (error) {
        unsubscribe?.();
        try { await prepared.close(); } finally { await server?.close(); }
        throw error;
      }
    }
    for (const command of ['dev', 'build', 'preview', 'prepare'] as const) {
      ctx.effect(() => ctx.commands.register(command, request => {
        const task = execute(command, request); pending.add(task);
        task.then(() => pending.delete(task), () => pending.delete(task)); return task;
      }));
    }
    ctx.effect(() => async () => {
      lifetime.abort(); await Promise.allSettled([...pending]);
      const results = await Promise.allSettled([...sessions].map(session => session.close()));
      for (const result of results) if (result.status === 'rejected') cleanupErrors.push(result.reason);
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Application command cleanup failed');
    });
  },
};
