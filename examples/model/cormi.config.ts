import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { modelPlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'application-model', plugin: modelPlugin, options: { id: 'application:model' } }],
  app: { base: '/models/', server: { host: '127.0.0.1', port: 8010 } },
});
