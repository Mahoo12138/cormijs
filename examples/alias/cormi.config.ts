import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { aliasPlugin } from '@cormijs/plugin-react-vite';

export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'alias', plugin: aliasPlugin, options: { aliases: { '@': 'src', '@shared': 'src/shared' } } }],
  app: { base: '/alias/', server: { host: '127.0.0.1', port: 8018 } },
});
