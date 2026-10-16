import { definePreset } from 'cormijs';
import { webPlugin, applicationCommandsPlugin, inspectionPlugin } from '@cormijs/plugin-web';
import { vitePlugin } from '@cormijs/plugin-vite';
import { reactPlugin } from '@cormijs/plugin-react';
import { reactVitePlugin } from '@cormijs/plugin-react-vite';
import { typescriptPlugin } from '@cormijs/plugin-typescript';

/** Explicit composition, not privileged kernel functionality. */
export const reactVite = definePreset({
  id: 'cormi:react-vite',
  plugins: [
    { id: 'web', plugin: webPlugin },
    { id: 'application-commands', plugin: applicationCommandsPlugin },
    { id: 'react', plugin: reactPlugin },
    { id: 'vite', plugin: vitePlugin },
    { id: 'react-vite', plugin: reactVitePlugin },
    { id: 'inspect', plugin: inspectionPlugin },
    { id: 'typescript', plugin: typescriptPlugin },
  ],
  defaults: { base: '/', outDir: 'dist' },
});
export default reactVite;
