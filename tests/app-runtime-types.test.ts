import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, cli } from './launcher-helpers.js';
import { writeAppRuntimeFixture, appRuntimeSource } from '../scripts/app-runtime-fixture.js';
async function checked(t: TestContext, root: string, expected=0) {
  const c=cli(t,root,'typecheck',['--startup-timeout','30000']);
  assert.equal(await c.finish(30000),expected,JSON.stringify(c.events)+c.stderr);
  if(expected) assert.ok(c.events.some(event=>event.code==='TYPECHECK_FAILED' && event.message.includes('.cormi/app.tsx')),JSON.stringify(c.events));
}
test('real generated app checks defineApp, named exports and native-key interface augmentation', {timeout:90000},async t=>{
  const f=await app(t);await writeAppRuntimeFixture(f.root);await checked(t,f.root);
  await f.write('src/app.tsx',`import type {RuntimeConfig} from '@cormijs/runtime';
export const rootContainer:RuntimeConfig['rootContainer']=(node,{basename})=><div data-base={basename}>{node}</div>;
export const onRouteChange:RuntimeConfig['onRouteChange']=({action,isFirst,location})=>{const pathname:string=location.pathname;void [action,isFirst,pathname];};
export const banner='named';`);
  await checked(t,f.root);
  await f.write('src/app.tsx',`import {defineApp} from '@cormijs/runtime';export default defineApp(()=>({banner:'factory',rootContainer:node=>node}));`);
  await checked(t,f.root);
});
test('unknown and mixed exports and wrongly typed extension values are not erased by generation', {timeout:90000},async t=>{
  const f=await app(t);await writeAppRuntimeFixture(f.root);
  // Unknown named/default keys must fail even without an explicit RuntimeConfig annotation.
  for(const source of ['export const unknownRuntimeKey=1;', 'export default {rootContainer:(n:unknown)=>n,typo:true};', 'export const banner="x";export default {};', 'export default {banner:42};', 'export default ()=>({rootContainer:42});']){
    await f.write('src/app.tsx',source);await checked(t,f.root,1);
  }
  await f.write('src/app.tsx',appRuntimeSource);await checked(t,f.root);
});
test('typecheck cannot omit app hooks through exclude and rejects an ordinary React component as configuration', {timeout:60000},async t=>{
  const f=await app(t);await writeAppRuntimeFixture(f.root);
  const config=JSON.parse(await readFile(join(f.root,'tsconfig.json'),'utf8'));config.exclude=['src/app.tsx','.cormi'];
  await writeFile(join(f.root,'tsconfig.json'),JSON.stringify(config));
  await f.write('src/app.tsx','export default function App(){return <div>This is not runtime configuration</div>}');
  await checked(t,f.root,1);
  await f.write('src/app.tsx','export default {render:async (next:()=>Promise<void>)=>{await next();}};');await checked(t,f.root);
});
