import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { headPlugin, routeConfigPlugin } from '@cormijs/plugin-react';
import { staticExportPlugin } from '@cormijs/plugin-react-vite';

const routes = [{
  id: 'shell', path: '/', component: './src/Shell.tsx', meta: { head: { title: '静态导出示例', metas: [{ name: 'description', content: '静态 HTML 外壳与运行时 head 组合' }] } }, routes: [
    { index: true, component: './src/Home.tsx' },
    { path: 'guide', component: './src/Guide.tsx', meta: { head: { title: '指南', links: [{ rel: 'canonical', href: '/static-export/guide' }] } } },
  ],
}] as const;

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
    { id: 'export', plugin: staticExportPlugin, options: { id: 'application:export', titleTemplate: ' · cormi' } },
    { id: 'head', plugin: headPlugin, options: { id: 'application:head', titleTemplate: ' · cormi' } },
  ],
  app: { base: '/static-export/', routes: [], server: { host: '127.0.0.1', port: 8026 } },
});
