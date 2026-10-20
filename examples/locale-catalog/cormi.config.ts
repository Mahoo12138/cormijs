import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin, localePlugin } from '@cormijs/plugin-react';

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'locale', plugin: localePlugin, options: { id: 'application:locale', directory: 'src/locales' } },
  ],
  app: { base: '/locale-catalog/', server: { host: '127.0.0.1', port: 8022 } },
});
