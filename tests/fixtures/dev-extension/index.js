import { defineReactFeature } from '@cormijs/plugin-react';
import api from './api.js';

/** Test fixture: one distribution, native child plugins, separate browser export. */
export default {
  name: 'fixture:extension', inject: ['react'],
  apply(ctx, options) {
    if (!options || typeof options.development !== 'boolean') throw new TypeError('Expected explicit command environment');
    ctx.plugin(defineReactFeature({ id: 'fixture:client', runtime: [{ id: 'fixture:client',
      module: { specifier: '@cormi-test/dev-extension/client', exportName: 'default' }, options: { label: options.label ?? 'installed' } }] }));
    if (options.development) ctx.plugin(api, options);
  },
};
