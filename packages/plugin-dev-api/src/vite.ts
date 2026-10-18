import type { Plugin } from '@cormijs/core';
import type {} from '@cormijs/plugin-vite';
import { DevApiSession, validateDevApi, type DevApiOptions } from './index.js';

/** Backend-specific bridge. Mock/proxy implementation lives independently in the main entry. */
export const devApiVitePlugin: Plugin.Object<DevApiOptions> = {
  name: 'cormi:dev-api-vite', inject: ['vite'],
  apply(ctx, options) {
    const config = validateDevApi(options), sessions = new Set<DevApiSession>();
    const unregister = ctx.vite.add('cormi:dev-api', () => {
      let session: DevApiSession | undefined;
      return {
        name: 'cormi:dev-api', enforce: 'pre',
        apply: (_config, environment) => environment.command === 'serve' && !environment.isPreview,
        configureServer(server) {
          session = new DevApiSession(config); sessions.add(session);
          server.middlewares.use(session.middleware);
        },
        async closeBundle() {
          if (session) { try { await session.close(); } finally { sessions.delete(session); } }
        },
      };
    }, -100);
    ctx.effect(() => async () => {
      unregister(); const results = await Promise.allSettled([...sessions].map(session=>session.close())); sessions.clear();
      const errors = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (errors.length) throw new AggregateError(errors.map(x=>x.reason), 'Development API cleanup failed');
    });
  },
};
