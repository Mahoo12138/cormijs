import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { accessPlugin, appRuntimePlugin, initialStatePlugin, menuPlugin, routeConfigPlugin } from '@cormijs/plugin-react';

const routes = [{
  id: 'shell', path: '/', component: './src/Shell.tsx', routes: [
    { index: true, component: './src/Home.tsx', meta: { title: '首页', order: 2 } },
    { path: 'about', component: './src/About.tsx', meta: { title: '关于', order: 1 } },
    { path: 'team', component: './src/Team.tsx', meta: { title: '团队', order: 4 }, routes: [
      { index: true, component: './src/TeamHome.tsx', meta: { title: '概览' } },
    ] },
    { path: 'admin', component: './src/Admin.tsx', meta: { title: '管理', order: 3, access: 'canAdmin' }, access: 'canAdmin' },
  ],
}];

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'initial-state', plugin: initialStatePlugin, options: { id: 'application:initial-state' } },
    { id: 'access', plugin: accessPlugin, options: { id: 'application:access' } },
    { id: 'menu', plugin: menuPlugin, options: { id: 'application:menu' } },
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
  ],
  app: { base: '/menu/', routes: [], server: { host: '127.0.0.1', port: 8015 } },
});
