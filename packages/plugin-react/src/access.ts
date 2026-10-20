import { CormiError, type Plugin } from '@cormijs/core';
import type { AppConfigContribution } from './app-runtime.js';
import type { RuntimeContribution } from './generate.js';
import type {} from './index.js';

export interface AccessPluginOptions {
  readonly id?: string;
}
/** Opt-in native plugin: registers the access key and provider; requires initialStatePlugin. */
export const accessPlugin: Plugin.Object<AccessPluginOptions> = {
  name: 'cormi:access', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'id')) {
      throw new CormiError('ACCESS_INVALID', 'Invalid access plugin options.');
    }
    const id = options.id ?? 'cormi:access';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('ACCESS_INVALID', 'Invalid access id.');
    const config: AppConfigContribution = { id, keys: ['access', 'accessForbidden'] };
    const runtime: RuntimeContribution = { id, module: { specifier: '@cormijs/runtime', exportName: 'accessRuntime' } };
    ctx.effect(() => ctx.react.appConfig.tap({ id: id + ':config', owner: id, ownerOrder: 0, run: () => [config] }));
    // Access reads the initial-state context, so its provider must be inside initialStateRuntime.
    ctx.effect(() => ctx.react.runtime.tap({ id: id + ':runtime', owner: id, ownerOrder: 0, stage: 10, run: () => [runtime] }));
  },
};
