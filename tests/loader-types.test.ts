import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { generateLoaderTypes, reactPlugin } from '@cormijs/plugin-react';
import type { ApplicationRequest } from '@cormijs/plugin-web';

test('generateLoaderTypes maps sorted route ids to awaited clientLoader results', () => {
  assert.equal(generateLoaderTypes([
    { id: 'config:guide', specifier: '../src/Guide.tsx', exportName: 'clientLoader' },
    { id: 'file:src/pages/home.tsx', specifier: '../src/pages/home.tsx', exportName: 'clientLoader' },
  ]), `declare namespace CormiLoaderData {
  interface Routes {
    "config:guide": Awaited<ReturnType<typeof import("../src/Guide.tsx")["clientLoader"]>>;
    "file:src/pages/home.tsx": Awaited<ReturnType<typeof import("../src/pages/home.tsx")["clientLoader"]>>;
  }
  type Data<Id extends keyof Routes> = Routes[Id];
}
`);
  assert.match(generateLoaderTypes([]), /interface Routes \{\n  \}/);
});

async function project(t: TestContext) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'cormi-loader-types 中文-'))), host = new ProjectRuntime();
  await mkdir(join(root, 'src/pages/posts'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(root, 'src/pages/index.tsx'), 'export default () => null;');
  await writeFile(join(root, 'src/pages/posts/[id].tsx'), `interface Post { id: string; title: string }
export default function PostPage(){return null;}
export async function clientLoader({ params }: { params: Record<string, string | undefined> }): Promise<Post> {
  return { id: params.id ?? '-', title: 'post' };
}`);
  host.mount('react', reactPlugin); await host.ready();
  const request: ApplicationRequest = { root, command: 'prepare', mode: 'test', options: {}, signal: new AbortController().signal };
  t.after(async () => { try { await host.dispose(); } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, host, request };
}

test('prepare publishes loader types for conventional client loaders', async t => {
  const f = await project(t);
  const session = await f.host.ctx.application.prepare(f.request); await session.close();
  const types = await readFile(join(f.root, '.cormi/loaders.d.ts'), 'utf8');
  assert.match(types, /declare namespace CormiLoaderData/);
  assert.match(types, /"file:src\/pages\/posts\/\[id\]\.tsx": Awaited<ReturnType<typeof import\("..\/src\/pages\/posts\/\[id\]\.tsx"\)\["clientLoader"\]>>;/);
  assert.doesNotMatch(types, /file:src\/pages\/index\.tsx/);
  assert.ok(session.typecheck?.files.includes('.cormi/loaders.d.ts'));
});
