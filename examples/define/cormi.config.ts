import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { aliasPlugin, definePlugin } from '@cormijs/plugin-react-vite';

export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'alias', plugin: aliasPlugin, options: { builtins: true } },
    {
      id: 'define',
      plugin: definePlugin,
      options: { values: { APP_NAME: 'cormi define', APP_FLAGS: { beta: true, retries: 2 }, 'process.env.APP_MODE': 'example' } },
    },
  ],
  app: { base: '/define/', server: { host: '127.0.0.1', port: 8019 } },
});
