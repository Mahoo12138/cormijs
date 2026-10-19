import { CormiError, snapshotConfig, type CommandRequest, type CommandResult, type ProjectRuntime } from '@cormijs/core';
import { defaultWorkerProfile, type WorkerApplication, type WorkerExecution, type WorkerReadiness, type WorkerReport } from './worker-profile.js';
import type { normalizeConfig } from './config.js';

type Config = ReturnType<typeof normalizeConfig>;
/** Owns one invocation and its result handle. Plugin lifetime remains entirely Cordis-owned. */
export function executionSession(host: ProjectRuntime, config: Config, command: string, request: CommandRequest,
  publish: (report: WorkerReport) => void, withdrawn: (error: CormiError) => void) {
  const lifetime = new AbortController();
  const signal = AbortSignal.any([request.signal, lifetime.signal]);
  let service: WorkerExecution | undefined, invoked = false, running = false, closing = false;
  let task: Promise<CommandResult> | undefined, activation: Promise<WorkerReadiness> | undefined, cleanup: Promise<void> | undefined;
  let closeHandle: (() => Promise<void>) | undefined;
  let reportBytes = 0, reportCount = 0;
  const application: WorkerApplication = Object.freeze({ runtime: host, configured: config.pluginSources,
    initialize() {
      if (activation) return activation;
      if (!running || closing || signal.aborted) return Promise.reject(new CormiError('EXECUTION_CLOSED', 'Application activation is outside the execution lifetime.'));
      activation = (async (): Promise<WorkerReadiness> => {
        try {
          for (const entry of config.plugins) { signal.throwIfAborted(); host.mount(entry.id, entry.plugin, entry.options); }
          await host.ready(); signal.throwIfAborted(); return Object.freeze({ ok: true });
        } catch (error) { return Object.freeze({ ok: false, error }); }
      })();
      return activation;
    },
  });
  function close(): Promise<void> {
    if (cleanup) return cleanup;
    closing = true;
    // Publish the Promise before abort dispatch, whose listeners may synchronously reenter.
    cleanup = Promise.resolve().then(async () => {
      lifetime.abort(new CormiError('EXECUTION_CLOSED', 'Worker execution is stopping.'));
      await task?.catch(() => {}); await activation;
      if (closeHandle) await closeHandle();
    });
    return cleanup;
  }
  function report(value: WorkerReport): void {
    if (!running || closing || signal.aborted) throw new CormiError('EXECUTION_CLOSED', 'Reporting is outside the execution lifetime.');
    const data = snapshotConfig(value, 'execution.report');
    const keys = Object.keys(data).sort().join(',');
    if (!data.data || typeof data.data !== 'object' || Array.isArray(data.data)
      || data.type !== 'diagnosis' && data.type !== 'execution-report'
      || data.type === 'diagnosis' && (keys !== 'data,type' || (data.data as Record<string, unknown>).format !== 'cormi:diagnosis:1')
      || data.type === 'execution-report' && (keys !== 'data,name,type' || typeof data.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9:._/-]{0,127}$/.test(data.name))) {
      throw new CormiError('EXECUTION_REPORT_INVALID', 'Invalid observation report.');
    }
    if (++reportCount > 64 || (reportBytes += Buffer.byteLength(JSON.stringify(data))) > 2 * 1024 * 1024) {
      throw new CormiError('EXECUTION_REPORT_LIMIT', 'Execution reports exceed the invocation budget.');
    }
    publish(data as unknown as WorkerReport);
  }
  async function run(): Promise<CommandResult> {
    if (invoked || closing) throw new CormiError('EXECUTION_REPEATED', 'A worker invocation cannot be replayed.');
    invoked = true;
    host.mount('cormi:execution-consumer', { name: 'cormi:execution-consumer', inject: ['workerExecution'], apply(ctx) {
      service = ctx.workerExecution;
      ctx.effect(() => async () => {
        if (!closing) {
          const error = new CormiError('EXECUTION_WITHDRAWN', 'Required worker execution provider was withdrawn.');
          // Schedule teardown first, but do not wait for it before requesting process shutdown.
          const draining = close(); withdrawn(error); await draining;
        } else await close();
      });
    } });
    host.mount('cormi:worker-profile', config.worker ?? defaultWorkerProfile, Object.freeze({ command }));
    await host.ready(); signal.throwIfAborted();
    if (!service || typeof service.run !== 'function') throw new CormiError('EXECUTION_SERVICE_INVALID', 'workerExecution must implement run().');
    running = true;
    task = Promise.resolve().then(() => service!.run(Object.freeze({ command, request: Object.freeze({ ...request, signal }), application, report })))
      .then(value => {
        // Capture a closable handle even if later result validation rejects its metadata.
        if (value?.kind === 'server' && value.handle && typeof value.handle.close === 'function') {
          const close = value.handle.close.bind(value.handle);
          let closed: Promise<void> | undefined;
          closeHandle = () => closed ??= Promise.resolve().then(close);
        }
        if (!value || value.kind !== 'result' && value.kind !== 'server') throw new CormiError('COMMAND_RESULT_INVALID', 'Execution returned an invalid result.');
        if (value.kind === 'server' && (!closeHandle || typeof value.handle.url !== 'string'
          || value.handle.applicationStatus !== undefined && !['ready','error'].includes(value.handle.applicationStatus))) {
          throw new CormiError('COMMAND_RESULT_INVALID', 'Execution returned an invalid server handle.');
        }
        if (value.kind === 'server') return Object.freeze({ kind: 'server' as const,
          handle: Object.freeze({ url: value.handle.url, applicationStatus: value.handle.applicationStatus, close: closeHandle! }) });
        return Object.freeze({ kind: 'result' as const, data: value.data });
      }).finally(() => { running = false; });
    const result = await task;
    // Even an executor that starts initialization without awaiting it cannot orphan that work.
    await activation; signal.throwIfAborted();
    return result;
  }
  return { run, close };
}
