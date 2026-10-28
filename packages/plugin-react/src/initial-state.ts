import { CormiError, type Plugin, type RuntimePluginDescriptor } from '@cormijs/core';
import type { AppConfigContribution } from './app-runtime.js';
import type {} from './index.js';

export interface InitialStatePluginOptions {
  readonly id?: string;
}
/** Opt-in native plugin: registers getInitialState and its browser provider. */
export const initialStatePlugin: Plugin.Object<InitialStatePluginOptions> = {
  name: 'cormi:initial-state', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'id')) {
      throw new CormiError('INITIAL_STATE_INVALID', 'Invalid initial state plugin options.');
    }
    const id = options.id ?? 'cormi:initial-state';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('INITIAL_STATE_INVALID', 'Invalid initial state id.');
    const config: AppConfigContribution = { id, keys: ['getInitialState'] };
    const runtime: RuntimePluginDescriptor = { id, module: { package: '@cormijs/runtime', export: 'initialStateRuntime' } };
    ctx.effect(() => ctx.react.appConfig.tap({ id: id + ':config', owner: id, ownerOrder: 0, run: () => [config] }));
    ctx.effect(() => ctx.react.runtime.tap({ id: id + ':runtime', owner: id, ownerOrder: 0, run: () => [runtime] }));
  },
};
