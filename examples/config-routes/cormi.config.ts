import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { routeConfigPlugin } from '@cormijs/plugin-react';
import { routes } from './src/app-routes';

export default defineConfig({
  presets: [preset],
  plugins: [{
    id: 'application-routes',
    plugin: routeConfigPlugin,
    options: { id: 'application:routes', routes },
  }],
  // 显式路由模式：空 IR 关闭 src/pages 的约定扫描，避免同路径被扫描两次。
  app: { base: '/routes/', routes: [], server: { host: '127.0.0.1', port: 8007 } },
});
