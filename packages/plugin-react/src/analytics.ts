import { CormiError, type Plugin, type RuntimePluginDescriptor } from '@cormijs/core';
import type {} from './index.js';

export interface AnalyticsPluginOptions {
  readonly id?: string;
  /** GA4 measurement id; when absent no gtag queue is created. */
  readonly measurementId?: string;
  readonly eventName?: string;
  /** Dispatch `cormi:pageview` CustomEvents in addition to gtag. */
  readonly dispatch?: boolean;
}
/** Opt-in plugin: emits one page-view per route change without owning a vendor script. */
export const analyticsPlugin: Plugin.Object<AnalyticsPluginOptions> = {
  name: 'cormi:analytics', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'measurementId', 'eventName', 'dispatch'].includes(key))) {
      throw new CormiError('ANALYTICS_INVALID', 'Invalid analytics plugin options.');
    }
    const id = options.id ?? 'cormi:analytics';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('ANALYTICS_INVALID', 'Invalid analytics id.');
    if (options.measurementId !== undefined && (typeof options.measurementId !== 'string' || !/^G-[A-Z0-9]{4,32}$/.test(options.measurementId))) {
      throw new CormiError('ANALYTICS_INVALID', 'measurementId must look like G-XXXXXXX.');
    }
    if (options.eventName !== undefined && (typeof options.eventName !== 'string' || !/^[a-z][a-z0-9_]{0,39}$/.test(options.eventName))) {
      throw new CormiError('ANALYTICS_INVALID', 'eventName must be a lowercase GA4 event name.');
    }
    if (options.dispatch !== undefined && typeof options.dispatch !== 'boolean') throw new CormiError('ANALYTICS_INVALID', 'dispatch must be a boolean.');
    const runtime: RuntimePluginDescriptor = {
      id, module: { package: '@cormijs/runtime', export: 'analyticsRuntime' },
      options: {
        ...(options.measurementId !== undefined ? { measurementId: options.measurementId } : {}),
        ...(options.eventName !== undefined ? { eventName: options.eventName } : {}),
        ...(options.dispatch !== undefined ? { dispatch: options.dispatch } : {}),
      },
    };
    ctx.effect(() => ctx.react.runtime.tap({ id: id + ':runtime', owner: id, ownerOrder: 0, stage: 50, run: () => [runtime] }));
  },
};
