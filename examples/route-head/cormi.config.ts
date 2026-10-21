import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { headPlugin, routeConfigPlugin } from '@cormijs/plugin-react';

const routes = [{
  id: 'shell', path: '/', component: './src/Shell.tsx', routes: [
    { index: true, component: './src/pages/Home.tsx', meta: { title: '首页', head: { title: '首页', metas: [{ name: 'description', content: '路由演示首页' }] } } },
    { path: 'guide', component: './src/pages/Guide.tsx', meta: { head: { title: '指南', links: [{ rel: 'canonical', href: '/route-head/guide' }] } } },
  ],
}] as const;

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
    { id: 'head', plugin: headPlugin, options: { id: 'application:head', titleTemplate: ' · cormi' } },
  ],
  // 显式路由模式：空 IR 关闭 src/pages 的约定扫描。
  app: { base: '/route-head/', routes: [], server: { host: '127.0.0.1', port: 8023 } },
});
