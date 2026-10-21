import type { Plugin } from '@cormijs/core';
import type {} from '@cormijs/plugin-vite';
import react from '@vitejs/plugin-react';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
export { htmlPlugin, applyHtmlHead, normalizeScript, type HtmlPluginOptions, type HtmlMeta, type HtmlLink, type HtmlScript, type NormalizedHtmlOptions } from './html.js';
export { aliasPlugin, resolveAliases, aliasEntries, type AliasPluginOptions, type ViteAlias } from './alias.js';
export { definePlugin, resolveDefines, applyDefines, mergeDefines, type DefinePluginOptions, type DefineEntry } from './define.js';
export { outputPlugin, resolveOutputCopy, stableOutputNames, type OutputPluginOptions, type OutputCopy } from './output.js';
export { staticExportPlugin, staticPages, notFoundPage, renderStaticPage, writeStaticPages, type StaticExportOptions, type StaticPage } from './static-export.js';
export { apiRoutePlugin, resolveApiRoutes, matchApiRoute, runApiHandler, type ApiRoutePluginOptions, type ApiRoute, type ApiHandler, type ApiHandlerContext } from './api.js';
export { mpaPlugin, resolveMpaEntries, mpaEntrySource, mpaHtml, type MpaPluginOptions, type MpaCandidate, type MpaEntry } from './mpa.js';
export { proxyPlugin, normalizeProxy, type ProxyPluginOptions, type ProxyTarget, type ProxyTargetOptions, type NormalizedProxyTarget } from './proxy.js';
export { ssrPlugin, type SsrPluginOptions } from './ssr.js';
export { servePlugin, type ServePluginOptions } from './serve.js';

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
