import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { routeConfigPlugin, routePrefetchPlugin } from '@cormijs/plugin-react';

const routes = [{
  id: 'shell', path: '/', component: './src/Shell.tsx', routes: [
    { index: true, component: './src/pages/Home.tsx' },
    { path: 'guide', component: './src/pages/Guide.tsx' },
  ],
}] as const;

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'routes', plugin: routeConfigPlugin, options: { id: 'application:routes', routes } },
    { id: 'prefetch', plugin: routePrefetchPlugin, options: { id: 'application:prefetch', mode: 'idle' } },
  ],
  app: { base: '/prefetch/', routes: [], server: { host: '127.0.0.1', port: 8024 } },
});
