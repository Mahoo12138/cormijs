import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { ProjectRuntime } from '@cormijs/core';
import { reactPlugin, appRuntimePlugin, appConfigContributions } from '@cormijs/plugin-react';
import { fixture, hasCode, gate } from './helpers.js';
import { until } from '../scripts/reliability/resources.js';
async function project(t: TestContext) {
  const f = await fixture(), host = new ProjectRuntime();
  await mkdir(join(f.root, 'src/pages'), { recursive: true });
  await writeFile(join(f.root, 'index.html'), '<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await writeFile(join(f.root, 'src/pages/index.tsx'), 'export default ()=>null;');
  host.mount('react', reactPlugin); await host.ready();
  t.after(async () => { await host.dispose(); await f.clean(); });
  const request = { root:f.root, command:'prepare' as const, mode:'development', options:{}, signal:new AbortController().signal };
  return { ...f, host, request, code:()=>readFile(join(f.root,'.cormi/app.tsx'),'utf8') };
}
test('app file discovery is native opt-in; disabling it preserves manually contributed runtime', async t => {
  const f = await project(t);
  await writeFile(join(f.root,'src/app.tsx'),'throw new Error("NODE_MUST_NOT_EVALUATE_APP");export const rootContainer=n=>n;');
  const plain = await f.host.ctx.application.prepare(f.request); await plain.close(); assert.doesNotMatch(await f.code(), /applicationConfig/);
  f.host.mount('app', appRuntimePlugin); await f.host.ready();
  const enabled = await f.host.ctx.application.prepare(f.request); await enabled.close(); assert.match(await f.code(), /applicationConfig/);
  await f.host.unmount('app');
  const explicit = await f.host.ctx.application.prepare({ ...f.request, options:{runtimeConfig:{specifier:'./src/app.tsx',exportName:'*'}} });
  await explicit.close(); assert.match(await f.code(), /applicationConfig/); assert.equal(f.host.ctx.get('builder'),undefined);
});
test('selected app files can be created, conflict, repair and disappear in the same compiler session', { timeout:15000 }, async t => {
  const f = await project(t); f.host.mount('app',appRuntimePlugin); await f.host.ready();
  const session = await f.host.ctx.application.prepare({...f.request,command:'dev'});
  try {
    assert.doesNotMatch(await f.code(), /applicationConfig/);
    await writeFile(join(f.root,'src/app.ts'),'export default {};');
    await until(async()=> (await f.code()).includes('applicationConfig'),'app created'); const previous = await f.code();
    await writeFile(join(f.root,'src/app.tsx'),'export default {};');
    await until(()=>session.development!.current().status==='error','conflict'); assert.equal(await f.code(),previous);
    await rm(join(f.root,'src/app.tsx')); await until(()=>session.development!.current().status==='ready','repair');
    assert.equal(await f.code(),previous);
    await rm(join(f.root,'src/app.ts')); await until(async()=>!(await f.code()).includes('applicationConfig'),'removed');
  } finally { await session.close(); }
});
test('custom conventions and explicit app modules reject ambiguous sources and symlink inputs', async t => {
  const f = await project(t); await writeFile(join(f.root,'src/application.jsx'),'export default {};');
  f.host.mount('app',appRuntimePlugin,{files:['src/application.jsx']}); await f.host.ready();
  const valid = await f.host.ctx.application.prepare(f.request); await valid.close(); assert.match(await f.code(),/application.jsx/);
  await assert.rejects(f.host.ctx.application.prepare({...f.request,options:{runtimeConfig:{specifier:'./src/application.jsx',exportName:'default'}}}),hasCode('APP_RUNTIME_CONFLICT'));
  await rm(join(f.root,'src/application.jsx')); await writeFile(join(f.root,'src/target.js'),'export default {};');
  await symlink(join(f.root,'src/target.js'),join(f.root,'src/application.jsx'));
  await assert.rejects(f.host.ctx.application.prepare(f.request),hasCode('CLIENT_MODULE_INVALID'));
});
test('runtime key contributions are revoked with their native owner and reject stale compilation', async t => {
  const f = await project(t); await writeFile(join(f.root,'src/app.ts'),'export default {banner:"hello"};');
  f.host.mount('app',appRuntimePlugin);
  f.host.mount('feature',{inject:['react'],apply(ctx){ctx.effect(()=>ctx.react.appConfig.tap({id:'feature:key',owner:'feature',ownerOrder:0,run:()=>[{id:'feature',keys:['banner']}]}));}});
  await f.host.ready(); const session = await f.host.ctx.application.prepare(f.request); await session.close(); assert.match(await f.code(),/\["banner"\]/);
  const entered=gate(),release=gate();
  const remove=f.host.ctx.react.routes.tap({id:'pause',owner:'test',ownerOrder:0,async run(routes){entered.resolve();await release.promise;return routes;}});
  const task=f.host.ctx.application.prepare(f.request); const failure=assert.rejects(task,hasCode('CONTRIBUTIONS_CHANGED'));
  await entered.promise; await f.host.unmount('feature'); release.resolve(); await failure; remove();
  const repaired=await f.host.ctx.application.prepare(f.request); await repaired.close(); assert.doesNotMatch(await f.code(),/\["banner"\]/);
});
test('runtime contributions reject duplicate keys, reserved hooks, malformed paths and competing declarations', () => {
  for(const input of [ [{id:'a',keys:['setup']}], [{id:'a',keys:['x']},{id:'b',keys:['x']}], [{id:'a',candidates:['../app.ts']}], [{id:'a',module:{specifier:'./a.ts',exportName:'*'},candidates:['a.ts']}] ]) assert.throws(()=>appConfigContributions(input));
  const source={id:'a',keys:['x']}; const copy=appConfigContributions([source]); source.keys.push('y'); assert.deepEqual(copy[0]!.keys,['x']);
});
