import type { Plugin } from '@cormijs/core';
import type {} from '@cormijs/plugin-web';

/** Organization deployment policy is an ordinary scoped Cordis plugin, not a Vite hook. */
export const deployment: Plugin.Object<void> = {
  name: 'example:deployment', inject: ['appConfig'],
  apply(ctx) {
    ctx.effect(() => ctx.appConfig.derive.tap({
      id: 'example:deployment:base', owner: 'example:deployment', ownerOrder: 0,
      run: ({ value, mode }) => mode === 'staging' ? { ...value, base: '/staging/' } : value,
    }));
  },
};
