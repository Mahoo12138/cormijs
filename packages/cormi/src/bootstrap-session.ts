import { ProjectRuntime, CormiError, type Plugin } from '@cormijs/core';
import { defaultBootstrap, type LaunchPolicy, type LaunchEnvironment, type LaunchReload } from './bootstrap.js';

export interface BootstrapServices { policy: LaunchPolicy; environment: LaunchEnvironment; reload: LaunchReload }
/** Reuses the same Cordis host in the carrier process; never executes application plugins there. */
export function bootstrapSession(profile: Plugin<void> = defaultBootstrap, timeout: number) {
  const host = new ProjectRuntime(timeout), lifetime = new AbortController(), pending = new Set<Promise<unknown>>();
  let services: BootstrapServices | undefined;
  host.mount('cormi:launch-consumer', { name:'cormi:launch-consumer', inject:['launchPolicy','launchEnvironment','launchReload'], apply(ctx) {
    services = {policy:ctx.launchPolicy,environment:ctx.launchEnvironment,reload:ctx.launchReload};
    ctx.effect(() => async () => {
      lifetime.abort(new CormiError('BOOTSTRAP_WITHDRAWN', 'Bootstrap service binding was withdrawn.'));
      await Promise.allSettled([...pending]);
    });
  } });
  // Mount inside ready() so even synchronous invalid-plugin failures can be disposed by the carrier.
  async function ready(): Promise<BootstrapServices> {
    host.mount('cormi:bootstrap', profile); await host.ready();
    if (!services || typeof services.policy?.resolve !== 'function' || typeof services.environment?.files !== 'function'
      || typeof services.environment?.load !== 'function' || typeof services.reload?.wait !== 'function') {
      throw new CormiError('BOOTSTRAP_SERVICE_INVALID', 'Bootstrap services must implement their complete contracts.');
    }
    return services;
  }
  function invoke<T>(operation: () => T | Promise<T>): Promise<T> {
    const task = Promise.resolve().then(() => { lifetime.signal.throwIfAborted(); return operation(); });
    pending.add(task); void task.then(() => pending.delete(task), () => pending.delete(task)); return task;
  }
  return { ready, invoke, signal:lifetime.signal,
    cancel() { lifetime.abort(new CormiError('STOP_REQUESTED','Bootstrap is stopping.')); },
    close() { lifetime.abort(); return host.dispose(); },
  };
}
