import { ProjectRuntime } from '@cormijs/core';
import { webPlugin } from '@cormijs/plugin-web';
import { vitePlugin } from '@cormijs/plugin-vite';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

// A one-shot P0 demo, not the future Cormi CLI or React preset.
const host = new ProjectRuntime();
const root = fileURLToPath(new URL('.', import.meta.url));
const plan = { root, entry: 'index.html', outDir: `dist-${randomUUID()}`, mode: 'production', base: '/' };
try {
  host.mount('web', webPlugin);
  host.mount('vite', vitePlugin);
  await host.ready();
  const result = await host.ctx.web.build(plan);
  const preview = await host.ctx.web.preview(plan);
  const response = await fetch(preview.url);
  if (!response.ok || !(await response.text()).includes('Cormi')) throw new Error('Preview smoke check failed');
  console.log(JSON.stringify({ result, preview: preview.url, status: response.status, plugins: host.inspect() }, null, 2));
  await preview.close();
} finally {
  await host.dispose();
}
