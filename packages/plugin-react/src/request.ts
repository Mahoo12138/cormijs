import { CormiError, type Plugin } from '@cormijs/core';
import type { AppConfigContribution } from './app-runtime.js';
import type { RuntimeContribution } from './generate.js';
import type {} from './index.js';

export interface RequestPluginOptions {
  readonly id?: string;
}
/** Opt-in native plugin: registers the request config key and browser provider. */
export const requestPlugin: Plugin.Object<RequestPluginOptions> = {
  name: 'cormi:request', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'id')) {
      throw new CormiError('REQUEST_INVALID', 'Invalid request plugin options.');
    }
    const id = options.id ?? 'cormi:request';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('REQUEST_INVALID', 'Invalid request id.');
    const config: AppConfigContribution = { id, keys: ['request'] };
    const runtime: RuntimeContribution = { id, module: { specifier: '@cormijs/runtime', exportName: 'requestRuntime' } };
    ctx.effect(() => ctx.react.appConfig.tap({ id: id + ':config', owner: id, ownerOrder: 0, run: () => [config] }));
    ctx.effect(() => ctx.react.runtime.tap({ id: id + ':runtime', owner: id, ownerOrder: 0, run: () => [runtime] }));
  },
};
