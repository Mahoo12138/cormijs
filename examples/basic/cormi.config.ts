import { defineConfig } from 'cormijs';
import reactVite from '@cormijs/preset-react-vite';

export default defineConfig({
  presets: [reactVite],
  app: {
    server: { host: '127.0.0.1', port: 8001 },
    runtime: [{ id: 'example:theme', module: { specifier: './src/runtime.tsx', exportName: 'default' }, options: { label: 'React + Cordis + Vite' } }],
  },
});
