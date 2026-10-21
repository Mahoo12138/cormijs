import { CormiError, type Plugin } from '@cormijs/core';
import type { RuntimeContribution } from './generate.js';
import type {} from './index.js';

export interface HeadPluginOptions {
  readonly id?: string;
  /** Appended to every route title, e.g. `" · cormi"`. */
  readonly titleTemplate?: string;
  /** Title restored when the application unmounts; defaults to the document title at mount time. */
  readonly baseTitle?: string;
  /** Set false to disable automatic per-navigation syncing. */
  readonly auto?: boolean;
}
/** Opt-in plugin: mirrors `meta.head` of the deepest matched route into document title/meta/link. */
export const headPlugin: Plugin.Object<HeadPluginOptions> = {
  name: 'cormi:route-head', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'titleTemplate', 'baseTitle', 'auto'].includes(key))) {
      throw new CormiError('HEAD_INVALID', 'Invalid route head plugin options.');
    }
    const id = options.id ?? 'cormi:route-head';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('HEAD_INVALID', 'Invalid route head id.');
    for (const key of ['titleTemplate', 'baseTitle'] as const) {
      const value = options[key];
      if (value !== undefined && (typeof value !== 'string' || value.length > 512 || /[\0\r\n]/.test(value))) {
        throw new CormiError('HEAD_INVALID', `${key} must be bounded text.`);
      }
    }
    if (options.auto !== undefined && typeof options.auto !== 'boolean') throw new CormiError('HEAD_INVALID', 'auto must be a boolean.');
    const runtime: RuntimeContribution = {
      id, module: { specifier: '@cormijs/runtime', exportName: 'headRuntime' },
      options: {
        ...(options.titleTemplate !== undefined ? { titleTemplate: options.titleTemplate } : {}),
        ...(options.baseTitle !== undefined ? { baseTitle: options.baseTitle } : {}),
        ...(options.auto !== undefined ? { auto: options.auto } : {}),
      },
    };
    ctx.effect(() => ctx.react.runtime.tap({ id: id + ':runtime', owner: id, ownerOrder: 0, stage: 30, run: () => [runtime] }));
  },
};
