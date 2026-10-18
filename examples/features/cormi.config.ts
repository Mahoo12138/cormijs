import { defineConfig } from 'cormijs';
import reactVite from '@cormijs/preset-react-vite';
import { statusFeature } from './features/status/plugin';

export default defineConfig({
  presets: [reactVite],
  plugins: [{ id: 'status-feature', enabled: true, plugin: statusFeature({ label: '本地工作台', parentId: 'shell' }) }],
  app: {
    base: '/workspace/',
    server: { host: '127.0.0.1', port: 8002 },
    routes: [
      { id: 'shell', path: '', module: { specifier: './src/Layout.tsx', exportName: 'default' }, source: {}, meta: { title: '工作台' } },
      { id: 'home', parentId: 'shell', index: true, module: { specifier: './src/Home.tsx', exportName: 'default' }, source: {}, meta: { title: '概览' } },
    ],
  },
});
