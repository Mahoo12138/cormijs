import { CormiError, type Plugin } from '@cormijs/core';
import { setTimeout as delay } from 'node:timers/promises';
import { environmentFiles, readEnvironmentFiles, type EnvironmentSnapshot } from './environment.js';

export { readEnvironmentFiles, environmentFiles } from './environment.js';
export type { EnvironmentSnapshot } from './environment.js';
/** Capture before provider-owned parsing; the carrier rechecks this stamp before admission. */
export { fingerprint as fingerprintFiles } from './inputs.js';

/** Carrier input, before importing or evaluating the application's configuration. */
export interface LaunchRequest {
  readonly command: string;
  readonly configurationCommand?: string;
  readonly mode?: string;
  readonly watch?: boolean;
}
/** Policy selects semantics, never a different command handler or a different process. */
export interface LaunchPlan {
  readonly configurationCommand: string;
  readonly mode: string;
  readonly nodeEnv: 'development' | 'production';
  readonly watch: boolean;
}
export interface LaunchPolicy { resolve(request: LaunchRequest): LaunchPlan }
export interface EnvironmentRequest {
  readonly root: string;
  readonly plan: LaunchPlan;
  readonly files: readonly string[];
  readonly signal: AbortSignal;
}
export interface LaunchEnvironment {
  /** Exact candidate paths, including currently absent files. Fixed for this launch. */
  files(root: string, plan: LaunchPlan): readonly string[];
  load(request: EnvironmentRequest): Promise<EnvironmentSnapshot>;
}
export interface ReloadRequest {
  readonly files: readonly string[];
  readonly intervalMs: number;
  readonly signal: AbortSignal;
}
/** Wake-up is a hint. The carrier always reconciles authoritative input fingerprints. */
export interface LaunchReload { wait(request: ReloadRequest): Promise<void> }
declare module 'cordis' {
  interface Context {
    launchPolicy: LaunchPolicy;
    launchEnvironment: LaunchEnvironment;
    launchReload: LaunchReload;
  }
}

export const defaultLaunchPolicyPlugin: Plugin.Object<void> = {
  name: 'cormi:launch-policy',
  apply(ctx) {
    ctx.provide('launchPolicy', { resolve(request) {
      const inspecting = request.command === 'config' || request.command === 'diagnose';
      if (request.configurationCommand !== undefined && (!inspecting || !/^[a-z][a-z0-9-]*$/.test(request.configurationCommand)
        || ['config', 'diagnose'].includes(request.configurationCommand))) {
        throw new CormiError('CONFIG_TARGET_INVALID', '--for is only valid for config/diagnose and requires an application command name.');
      }
      if (request.command === 'diagnose' && request.watch) throw new CormiError('DIAGNOSIS_WATCH_UNSUPPORTED', 'Diagnosis is a one-shot snapshot.');
      const configurationCommand = inspecting ? request.configurationCommand ?? 'dev' : request.command;
      const nodeEnv = configurationCommand === 'dev' ? 'development' : 'production';
      return { configurationCommand, nodeEnv, mode: request.mode ?? nodeEnv, watch: request.watch ?? request.command === 'dev' };
    } } satisfies LaunchPolicy);
  },
};
export const dotenvEnvironmentPlugin: Plugin.Object<void> = {
  name: 'cormi:dotenv-environment',
  apply(ctx) {
    ctx.provide('launchEnvironment', {
      files: (root, plan) => environmentFiles(root, plan.mode),
      async load({root, plan, files, signal}) {
        signal.throwIfAborted();
        const snapshot = await readEnvironmentFiles(root, plan.mode, files);
        signal.throwIfAborted(); return snapshot;
      },
    } satisfies LaunchEnvironment);
  },
};
export const pollingReloadPlugin: Plugin.Object<void> = {
  name: 'cormi:polling-reload',
  apply(ctx) {
    const lifetime = new AbortController(), pending = new Set<Promise<void>>();
    ctx.provide('launchReload', { wait(request) {
      const signal = AbortSignal.any([lifetime.signal, request.signal]);
      const task = delay(request.intervalMs, undefined, {signal});
      pending.add(task);
      void task.then(() => pending.delete(task), () => pending.delete(task));
      return task;
    } } satisfies LaunchReload);
    ctx.effect(() => async () => { lifetime.abort(); await Promise.allSettled([...pending]); });
  },
};
export interface BootstrapProviders {
  readonly policy?: Plugin<void>;
  readonly environment?: Plugin<void>;
  readonly reload?: Plugin<void>;
}
/** A native composition, not an override registry. Supplying a provider replaces that default. */
export function createBootstrap(providers: BootstrapProviders = {}): Plugin.Object<void> {
  const { policy = defaultLaunchPolicyPlugin, environment = dotenvEnvironmentPlugin, reload = pollingReloadPlugin } = providers;
  return { name: 'cormi:bootstrap', apply(ctx) {
    ctx.plugin(policy); ctx.plugin(environment); ctx.plugin(reload);
  } };
}
export const defaultBootstrap = createBootstrap();
