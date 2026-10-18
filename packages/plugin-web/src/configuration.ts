import { assertActive, CormiError, snapshotConfig, configLeaves, configLayer,
  type ConfigData, type ConfigLayer, type CommandRequest, type Plugin } from '@cormijs/core';
import { OrderedHooks } from './ordered-hooks.js';

export interface ConfigDerivation {
  readonly value: ConfigData;
  readonly command: string;
  readonly mode: string;
  readonly signal: AbortSignal;
}
export interface ResolvedAppConfig { readonly value: ConfigData; readonly layers: readonly ConfigLayer[]; readonly report: ConfigReport }
export interface ConfigReport {
  readonly basis: 'current-config-evaluation';
  readonly command: string;
  readonly mode: string;
  readonly validation: 'json-and-derivation-only';
  readonly scope: string;
  readonly fields: readonly { readonly path: string; readonly present: boolean; readonly value: unknown; readonly redacted: boolean;
    readonly history: readonly { readonly kind: string; readonly id: string; readonly operation: 'set' | 'delete' }[] }[];
  readonly hooks: readonly { readonly id: string; readonly owner: string; readonly stage: number }[];
  readonly plugins: NonNullable<CommandRequest['configuration']>['plugins'];
}
const allowed = new Set(['/entry','/base','/outDir','/pages','/mountId','/server/host','/server/port']);
function disclosure(path: string, value: unknown): { value: unknown; redacted: boolean } {
  // An allowlist, not a secret-name denylist. Never serialize runtime options or arbitrary app values.
  if (allowed.has(path) && (typeof value === 'number' && Number.isFinite(value)
    || typeof value === 'string' && value.length <= 256 && !/[\x00-\x1f\x7f?#%@\\]/.test(value))) return { value, redacted: false };
  return { value: '[redacted]', redacted: true };
}
export class ApplicationConfiguration {
  readonly derive = new OrderedHooks<ConfigDerivation, ConfigData>('deriveConfig');
  private readonly lifetime = new AbortController();
  private readonly pending = new Set<Promise<ResolvedAppConfig>>();
  private closing?: Promise<void>;
  resolve(request: CommandRequest, command: string): Promise<ResolvedAppConfig> {
    const signal = AbortSignal.any([request.signal, this.lifetime.signal]);
    const work = async (): Promise<ResolvedAppConfig> => {
      signal.throwIfAborted();
      const revision = this.derive.revision, hooks = this.derive.snapshot();
      if (hooks.length > 256) throw new CormiError('CONFIG_DERIVE_LIMIT', 'Too many application configuration derivations.');
      let value = snapshotConfig(request.options);
      const initial = request.configuration?.layers ?? [configLayer({}, value, { kind: 'input', id: 'command-input' }, value)];
      const layers: ConfigLayer[] = [...initial];
      for (const hook of hooks) {
        signal.throwIfAborted();
        let returned: unknown;
        try { returned = await hook.run(Object.freeze({ value, command, mode: request.mode, signal })); }
        catch (cause) { throw new CormiError('CONFIG_DERIVE_FAILED', `Configuration derivation failed: ${hook.id}`, { pluginId: hook.owner, hookId: hook.id }, { cause }); }
        signal.throwIfAborted();
        const next = snapshotConfig(returned, `derive(${hook.id})`);
        for (const reserved of ['root','command','mode','plugins','presets','watch']) {
          if (Object.hasOwn(next, reserved) && (!Object.hasOwn(value, reserved) || JSON.stringify(next[reserved]) !== JSON.stringify(value[reserved]))) {
            throw new CormiError('CONFIG_DERIVE_RESERVED', `Derivations cannot set bootstrap field: ${reserved}`, { pluginId: hook.owner, hookId: hook.id });
          }
        }
        layers.push(configLayer(value, next, { kind: 'derive', id: hook.id })); value = next;
      }
      if (this.derive.revision !== revision) throw new CormiError('CONFIG_DERIVE_CHANGED', 'Configuration contributors changed during resolution; discard this result.');
      signal.throwIfAborted();
      const leaves = configLeaves(value), history = new Map<string, Array<{kind:string;id:string;operation:'set'|'delete'}>>();
      for (const layer of layers) for (const change of layer.changes) {
        const items = history.get(change.path) ?? []; items.push(Object.freeze({ ...layer.source, operation: change.operation })); history.set(change.path, items);
      }
      const fields = [...new Set([...leaves.keys(), ...history.keys()])].sort().map(path => Object.freeze({
        path, present: leaves.has(path), ...(leaves.has(path) ? disclosure(path, leaves.get(path)) : { value: '[absent]', redacted: false }),
        history: Object.freeze(history.get(path) ?? []),
      }));
      const report: ConfigReport = Object.freeze({ basis: 'current-config-evaluation', command, mode: request.mode,
        validation: 'json-and-derivation-only', scope: 'Application input after preset/user merge and registered derivations; excludes renderer/bundler defaults and private plugin options.',
        fields: Object.freeze(fields), hooks: Object.freeze(hooks.map(h => Object.freeze({id:h.id,owner:h.owner,stage:h.stage??0}))),
        plugins: Object.freeze([...(request.configuration?.plugins ?? [])]),
      });
      return Object.freeze({ value, layers: Object.freeze(layers), report });
    };
    const task = work(); this.pending.add(task);
    task.then(() => this.pending.delete(task), () => this.pending.delete(task)); return task;
  }
  close(): Promise<void> {
    return this.closing ??= (async () => { this.lifetime.abort(); await Promise.allSettled([...this.pending]); })();
  }
}
declare module 'cordis' { interface Context { appConfig: ApplicationConfiguration } }

/** Optional application policy. Native Cordis owns registrations and cancellation; the host has no Web defaults. */
export const applicationConfigPlugin: Plugin.Object<void> = {
  name: 'cormi:application-config', inject: ['commands'],
  apply: ctx => {
    const service = new ApplicationConfiguration(); ctx.provide('appConfig', service);
    ctx.effect(() => ctx.commands.use('cormi:application-config', async (name, request, next) => {
      assertActive(ctx);
      // inspect intentionally keeps its last-successful-generation contract.
      if (name === 'config' || name === 'inspect') return next(request);
      const resolved = await service.resolve(request, request.configuration?.command ?? name);
      return next(Object.freeze({ ...request, options: resolved.value }));
    }));
    ctx.effect(() => ctx.commands.register('config', async request => {
      assertActive(ctx);
      const resolved = await service.resolve(request, request.configuration?.command ?? 'dev');
      return { kind: 'result', data: resolved.report };
    }));
    ctx.effect(() => () => service.close());
  },
};
