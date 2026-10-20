import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { mockPlugin } from '@cormijs/plugin-dev-api';
import { devApiVitePlugin } from '@cormijs/plugin-dev-api/vite';

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'dev-api', plugin: devApiVitePlugin },
    { id: 'mock', plugin: mockPlugin, options: { intervalMs: 200 } },
  ],
  app: { base: '/mock/', server: { host: '127.0.0.1', port: 8017 } },
});
