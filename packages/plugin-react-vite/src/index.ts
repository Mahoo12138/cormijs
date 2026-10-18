import type { Plugin } from '@cormijs/core';
import type {} from '@cormijs/plugin-vite';
import react from '@vitejs/plugin-react';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** All Vite-specific React behavior stays in this optional bridge. */
export const reactVitePlugin: Plugin.Object<void> = {
  name: 'cormi:react-vite', inject: ['vite'],
  apply: ctx => {
    ctx.effect(() => ctx.vite.add('cormi:react-vite', () => [
      react(),
      {
        name: 'cormi:react-client-boundary', enforce: 'pre',
        config(config) {
          const runtime = dirname(fileURLToPath(import.meta.resolve('@cormijs/runtime')));
          return { resolve: { dedupe: ['react', 'react-dom', 'react-router'] },
            optimizeDeps: { noDiscovery: false, include: ['react', 'react-dom/client', 'react-router', 'react-router/dom'] },
            server: { fs: { allow: [...(config.server?.fs?.allow ?? []), runtime] } } };
        },
        resolveId(id) {
          if (id === 'cormijs' || id.startsWith('cormijs/') || id.startsWith('node:')
            || id === 'cordis' || id.startsWith('cordis/') || id.startsWith('@cordisjs/')
            || /^@cormijs\/(?:core|builder|routes|plugin-[^/]+|preset-[^/]+)(?:\/|$)/.test(id)) {
            throw new Error(`CLIENT_SERVER_IMPORT: ${id} belongs to the Node toolchain, not the browser`);
          }
        },
      },
    ]));
  },
};
