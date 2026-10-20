import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { layoutPlugin, loadingPlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'application-layout', plugin: layoutPlugin, options: { id: 'application:layout' } },
    { id: 'application-loading', plugin: loadingPlugin, options: { id: 'application:loading' } },
  ],
  app: { base: '/conventions/', server: { host: '127.0.0.1', port: 8008 } },
});
