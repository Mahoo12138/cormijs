import type { Plugin } from '@cormijs/core';
import type {} from '@cormijs/plugin-vite';
import { DevApiService, type DevApiHandle } from './service.js';
import { validateDevApi, type DevApiOptions } from './index.js';

/** Native backend adapter consumes the service; feature contributors do not depend on Vite. */
export const devApiViteBridge: Plugin.Object<void> = {
  name: 'cormi:dev-api-transport-vite', inject: ['vite', 'devApi'],
  apply(ctx) {
    const sessions = new Set<DevApiHandle>();
    const unregister = ctx.vite.add('cormi:dev-api', () => {
      let session: DevApiHandle | undefined;
      return {
        name: 'cormi:dev-api', enforce: 'pre',
        apply: (_config, environment) => environment.command === 'serve' && !environment.isPreview,
        configureServer(server) {
          session = ctx.devApi.open(); sessions.add(session);
          server.middlewares.use(session.middleware);
        },
        async closeBundle() {
          if (session) { try { await session.close(); } finally { sessions.delete(session); } }
        },
      };
    }, -100);
    ctx.effect(() => async () => {
      unregister(); const results = await Promise.allSettled([...sessions].map(s => s.close())); sessions.clear();
      const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (errors.length) throw new AggregateError(errors.map(r => r.reason), 'Development API bridge cleanup failed');
    });
  },
};

/** Backward-compatible one-entry composition, using native Cordis child plugins, not a second loader. */
export const devApiVitePlugin: Plugin.Object<DevApiOptions> = {
  name: 'cormi:dev-api-vite', inject: ['vite'],
  apply(ctx, options) {
    ctx.plugin(DevApiService, validateDevApi(options));
    ctx.plugin(devApiViteBridge);
  },
};
