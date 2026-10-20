import { CormiError, type Plugin } from '@cormijs/core';
import type { AppConfigContribution } from './app-runtime.js';
import type { RuntimeContribution } from './generate.js';
import type {} from './index.js';

export interface LocalePluginOptions {
  readonly id?: string;
}
/** Opt-in native plugin: registers the locale config key and browser provider. */
export const localePlugin: Plugin.Object<LocalePluginOptions> = {
  name: 'cormi:locale', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'id')) {
      throw new CormiError('LOCALE_INVALID', 'Invalid locale plugin options.');
    }
    const id = options.id ?? 'cormi:locale';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('LOCALE_INVALID', 'Invalid locale id.');
    const config: AppConfigContribution = { id, keys: ['locale'] };
    const runtime: RuntimeContribution = { id, module: { specifier: '@cormijs/runtime', exportName: 'localeRuntime' } };
    ctx.effect(() => ctx.react.appConfig.tap({ id: id + ':config', owner: id, ownerOrder: 0, run: () => [config] }));
    ctx.effect(() => ctx.react.runtime.tap({ id: id + ':runtime', owner: id, ownerOrder: 0, run: () => [runtime] }));
  },
};
