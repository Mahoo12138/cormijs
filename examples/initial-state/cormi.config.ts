import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin, initialStatePlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'initial-state', plugin: initialStatePlugin, options: { id: 'application:initial-state' } },
  ],
  app: { base: '/initial-state/', server: { host: '127.0.0.1', port: 8011 } },
});
