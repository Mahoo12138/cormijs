import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { globalStylePlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'styles', plugin: globalStylePlugin, options: { id: 'app:styles' } }],
  app: { base: '/global-style/', server: { host: '127.0.0.1', port: 8020 } },
});
