import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { outputPlugin } from '@cormijs/plugin-react-vite';

export default defineConfig({
  presets: [preset],
  plugins: [{
    id: 'output', plugin: outputPlugin,
    options: { hash: false, copy: [{ from: 'static', to: 'extras' }, { from: 'static/robots.txt' }] },
  }],
  app: { base: '/output/', server: { host: '127.0.0.1', port: 8025 } },
});
