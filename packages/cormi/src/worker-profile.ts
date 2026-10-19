import { CormiError, DiagnosticService, type CommandRequest, type CommandResult, type ConfigurationContext, type Plugin, type ProjectRuntime } from '@cormijs/core';
import { commandPlugin } from './commands.js';
import { diagnose, type Diagnosis } from './diagnose.js';

export type WorkerReadiness = { readonly ok: true } | { readonly ok: false; readonly error: unknown };
export interface WorkerApplication {
  /** Trusted in-process integration, not a sandbox or a serializable Context. */
  readonly runtime: ProjectRuntime;
  readonly configured: ConfigurationContext['plugins'];
  /** Single activation attempt. Repeated calls join the same readiness result. */
  initialize(): Promise<WorkerReadiness>;
}
export type WorkerReport =
  | { readonly type: 'diagnosis'; readonly data: Diagnosis }
  | { readonly type: 'execution-report'; readonly name: string; readonly data: Readonly<Record<string, unknown>> };
export interface WorkerExecutionContext {
  readonly command: string;
  readonly request: CommandRequest;
  readonly application: WorkerApplication;
  /** Observations only; cannot announce readiness, successful results or process exit. */
  report(report: WorkerReport): void;
}
export interface WorkerExecution { run(context: WorkerExecutionContext): Promise<CommandResult> }
export interface WorkerProfileOptions { readonly command: string }
declare module 'cordis' { interface Context { workerExecution: WorkerExecution } }

export const commandExecutionPlugin: Plugin.Object<void> = {
  name: 'cormi:command-execution', inject: ['commands'],
  apply(ctx) {
    ctx.provide('workerExecution', { async run({ command, request, application }) {
      const readiness = await application.initialize();
      request.signal.throwIfAborted();
      if (!readiness.ok) throw readiness.error;
      return ctx.commands.execute(command, request);
    } } satisfies WorkerExecution);
  },
};

export const diagnosticExecutionPlugin: Plugin.Object<void> = {
  name: 'cormi:diagnostic-execution', inject: ['diagnostics'],
  apply(ctx) {
    ctx.provide('workerExecution', { async run({ request, application, report }) {
      const readiness = await application.initialize();
      request.signal.throwIfAborted();
      const failure = readiness.ok ? undefined : readiness.error ?? new CormiError('PLUGIN_FAILED', 'Application initialization failed.');
      const data = diagnose(application.runtime, application.configured, request.configuration?.command ?? 'dev', request.mode, failure);
      if (!data.healthy) {
        report({ type: 'diagnosis', data });
        throw new CormiError('DIAGNOSIS_UNHEALTHY', 'Plugin readiness or diagnostic collection failed; see the diagnosis snapshot.');
      }
      return { kind: 'result', data };
    } } satisfies WorkerExecution);
  },
};

export interface WorkerProviders {
  readonly execution?: Plugin<void>;
  readonly commands?: Plugin<void> | false;
  readonly diagnostics?: Plugin<void> | false;
}
/** Default product selection lives in this replaceable composition, not worker transport. */
export function createWorkerProfile(providers: WorkerProviders = {}): Plugin.Object<WorkerProfileOptions> {
  const { execution, commands = commandPlugin, diagnostics = DiagnosticService } = providers;
  return { name: 'cormi:worker-profile', apply(ctx, { command }) {
    if (diagnostics !== false) ctx.plugin(diagnostics);
    if (commands !== false) {
      if (diagnostics === false) ctx.plugin(commands);
      else ctx.plugin({ name: 'cormi:observed-commands', inject: ['diagnostics'], apply(child) { child.plugin(commands); } });
    }
    ctx.plugin(execution ?? (command === 'diagnose' ? diagnosticExecutionPlugin : commandExecutionPlugin));
  } };
}
export const defaultWorkerProfile = createWorkerProfile();
