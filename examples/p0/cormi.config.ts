import { defineConfig, definePreset } from 'cormijs';
import { webPlugin, webCommandsPlugin } from '@cormijs/plugin-web';
import { vitePlugin } from '@cormijs/plugin-vite';

// Explicit HTML composition. This is not yet the planned React preset.
const htmlVite = definePreset({
  id: 'example:html-vite',
  plugins: [
    { id: 'web', plugin: webPlugin },
    { id: 'web-commands', plugin: webCommandsPlugin },
    { id: 'vite', plugin: vitePlugin },
  ],
  defaults: { base: '/', outDir: 'dist', server: { host: '127.0.0.1', port: 8000 } },
});
export default defineConfig({ presets: [htmlVite] });
