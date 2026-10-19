import assert from 'node:assert/strict';
import { mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { reactPlugin } from '@cormijs/plugin-react';
import { readInspection } from '@cormijs/plugin-web';
import { atomicWrite, returnedTo, sample, until } from './resources.js';

// No bundler or browser is needed for this domain's real-filesystem generation contract.
export async function generationBatches(root: string, batches: number) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await writeFile(join(root, 'index.html'), '<script type="module" src="/.cormi/app.tsx"></script>');
  const page = 'export default function Page(){return <h1>reliability</h1>}';
  await writeFile(join(root, 'src/pages/index.tsx'), page);
  const host = new ProjectRuntime(10000); host.mount('react', reactPlugin); await host.ready();
  const baseline = await sample();
  const session = await host.ctx.application.prepare({ root, command: 'dev', mode: 'development', options: {}, signal: new AbortController().signal });
  const state = () => session.development!.current();
  let notifications = 0, previous: string | undefined;
  const unsubscribe = session.updates!.subscribe(async () => { notifications++; });
  const observations = [];
  try {
    for (let i = 0; i < batches; i++) {
      const filename = 'step-' + i + '.tsx', file = join(root, 'src/pages', filename);
      const oldRevision = state().revision;
      if (previous) await rm(join(root, 'src/pages', previous));
      await atomicWrite(file, page);
      await until(async () => state().status === 'ready' && state().revision > oldRevision && (await readFile(join(root, '.cormi/app.tsx'), 'utf8')).includes(filename), 'latest page committed');
      const inspection = readInspection(root);
      const routes = (inspection.summary as { routes: Array<{ path?: string }> }).routes;
      assert.equal(routes.length, 2);
      if (i % 10 === 0) {
        const before = await readFile(join(root, '.cormi/app.tsx'));
        const modified = await stat(join(root, '.cormi/app.tsx'));
        const deliveries = notifications;
        const conflict = join(root, 'src/pages', filename.replace('.tsx', '.jsx'));
        await writeFile(conflict, page);
        await until(() => state().status === 'error', 'duplicate route diagnostic');
        assert.deepEqual(await readFile(join(root, '.cormi/app.tsx')), before);
        await rm(conflict);
        await until(() => state().status === 'ready', 'same-output repair');
        assert.equal(notifications, deliveries); assert.equal((await stat(join(root, '.cormi/app.tsx'))).mtimeMs, modified.mtimeMs);
      }
      observations.push({ batch: i, revision: state().revision, generation: readInspection(root).generation, notifications, sample: await sample() });
      previous = filename;
    }
  } finally { unsubscribe(); await session.close(); await host.dispose(); }
  await returnedTo(baseline.resources);
  return { batches, expectedConflictRepairs: Math.ceil(batches / 10), observations, final: await sample(), browserValidatedHere: false };
}
