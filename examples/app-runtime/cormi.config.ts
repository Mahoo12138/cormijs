import { defineConfig } from 'cormijs';
import reactVite from '@cormijs/preset-react-vite';
import { appRuntimePlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [reactVite],
  plugins: [{ id: 'app-runtime', plugin: appRuntimePlugin }],
  app: { base: '/runtime/', server: { host: '127.0.0.1', port: 8006 } },
});
