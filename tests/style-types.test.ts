import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { generateStyleTypes, reactPlugin, styleTypesPlugin } from '@cormijs/plugin-react';
import type { ApplicationRequest } from '@cormijs/plugin-web';

test('generateStyleTypes declares CSS modules and common asset imports', () => {
  const types = generateStyleTypes();
  assert.match(types, /declare module '\*\.module\.css' { const classes: Readonly<Record<string, string>>; export default classes; }/);
  assert.match(types, /declare module '\*\.module\.scss'/);
  assert.match(types, /declare module '\*\.css';/);
  assert.match(types, /declare module '\*\.svg' { const src: string; export default src; }/);
  assert.doesNotMatch(types, /declare module '\*\.ts'/);
});

test('prepare publishes styles.d.ts and includes it in typecheck inputs', async (t: TestContext) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-style-types 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default () => null;');
  await writeFile(join(root, 'src/component.module.css'), '.root { color: red; }');
  host.mount('react', reactPlugin); host.mount('style-types', styleTypesPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: {}, signal: new AbortController().signal };
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  const session = await host.ctx.application.prepare(request); await session.close();
  const types = await readFile(join(root, '.cormi/styles.d.ts'), 'utf8');
  assert.match(types, /\.module\.css/);
  assert.ok(session.typecheck?.files.includes('.cormi/styles.d.ts'));
});
