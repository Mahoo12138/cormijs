import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';

export default defineConfig({
  presets: [preset],
  app: { base: '/history/', history: 'hash', server: { host: '127.0.0.1', port: 8009 } },
});
