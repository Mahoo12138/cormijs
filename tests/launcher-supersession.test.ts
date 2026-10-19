import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { app, cli, webConfig, cleanLauncher } from './launcher-helpers.js';

async function waitFile(path: string) {
  const end = Date.now() + 10000;
  while (!existsSync(path)) {
    assert.ok(Date.now() < end, `Expected lifecycle checkpoint: ${path}`);
    await delay(20);
  }
}
const support = `import {appendFileSync,existsSync,writeFileSync} from 'node:fs';
import {setTimeout as wait} from 'node:timers/promises';`;
const applied = `appendFileSync('applied.log', value+'\\n');`;

// A compiled candidate is not current forever: disposal is an asynchronous admission boundary.
test('configuration edited during old-worker disposal never activates the obsolete candidate', { timeout: 25000 }, async t => {
  const f = await app(t);
  await f.write('settings.ts', 'export const value="A";');
  await f.write('cormi.config.ts', webConfig(`${applied}
if(value==='A') ctx.effect(()=>async()=>{writeFileSync('stopping.flag','yes');while(!existsSync('release.flag'))await wait(15);});`, '{}', support + `import {value} from './settings';`));
  const dev = cli(t, f.root, 'dev', ['--shutdown-timeout', '10000']);
  try {
    await dev.waitFor(e => e.type === 'ready');
    await f.write('settings.ts', 'export const value="B";');
    await waitFile(join(f.root, 'stopping.flag'));
    await f.write('settings.ts', 'export const value="C";');
    await f.write('release.flag', 'yes');
    const next = await dev.waitFor(e => e.type === 'ready' && e.generation > 1);
    assert.equal(await (await fetch(new URL('version', next.url))).text(), 'C', 'Readiness must describe the newest admitted configuration');
    assert.deepEqual((await readFile(join(f.root, 'applied.log'), 'utf8')).trim().split('\n'), ['A', 'C'], 'Obsolete B must not execute its plugin initializer');
    assert.equal(await dev.stop(), 0); await cleanLauncher(f.root);
  } finally { await writeFile(join(f.root, 'release.flag'), 'yes'); }
});

test('a startup candidate changed during async initialization is not announced ready', { timeout: 25000 }, async t => {
  const f = await app(t);
  await f.write('settings.ts', 'export const value="old";');
  await f.write('cormi.config.ts', webConfig(`${applied}
if(value==='old'){writeFileSync('initializing.flag','yes');while(!existsSync('release.flag'))await wait(15);}`, '{}', support + `import {value} from './settings';`));
  const dev = cli(t, f.root, 'dev', ['--startup-timeout', '15000']);
  try {
    await waitFile(join(f.root, 'initializing.flag'));
    await f.write('settings.ts', 'export const value="latest";');
    await f.write('release.flag', 'yes');
    const ready = await dev.waitFor(e => e.type === 'ready');
    assert.equal(await (await fetch(new URL('version', ready.url))).text(), 'latest');
    assert.ok(dev.events.some(e => e.type === 'superseded' && e.generation === 1));
    assert.equal(dev.events.filter(e => e.type === 'ready').length, 1);
    assert.equal(await dev.stop(), 0); await cleanLauncher(f.root);
  } finally { await writeFile(join(f.root, 'release.flag'), 'yes'); }
});

test('a broken newest configuration during disposal does not boot an older valid candidate', { timeout: 25000 }, async t => {
  const f = await app(t);
  await f.write('settings.ts', 'export const value="A";');
  await f.write('cormi.config.ts', webConfig(`${applied}
if(value==='A')ctx.effect(()=>async()=>{writeFileSync('stopping.flag','yes');while(!existsSync('release.flag'))await wait(15);});`, '{}', support + `import {value} from './settings';`));
  const dev = cli(t, f.root, 'dev', ['--shutdown-timeout','10000']);
  try {
    await dev.waitFor(e=>e.type==='ready');
    await f.write('settings.ts','export const value="B";'); await waitFile(join(f.root,'stopping.flag'));
    await f.write('settings.ts','export const value = { invalid syntax'); await f.write('release.flag','yes');
    await dev.waitFor(e=>e.code==='CONFIG_COMPILE_FAILED'&&e.servingPrevious===false);
    await delay(500); assert.equal(dev.events.filter(e=>e.type==='starting').length,1);
    assert.equal((await readFile(join(f.root,'applied.log'),'utf8')).trim(),'A');
    await f.write('settings.ts','export const value="repaired";');
    const ready=await dev.waitFor(e=>e.type==='ready'&&e.generation>1);
    assert.equal(await (await fetch(new URL('version',ready.url))).text(),'repaired');
    assert.equal(await dev.stop(),0);await cleanLauncher(f.root);
  } finally {await writeFile(join(f.root,'release.flag'),'yes');}
});

test('an explicit watch change during initialization also supersedes readiness', {timeout:25000}, async t=>{
  const f=await app(t);await f.write('data.json','{"version":"old"}');
  const source=webConfig(`if(value==='old'){writeFileSync('initializing.flag','yes');while(!existsSync('release.flag'))await wait(15);}`, '{}',
    support+`import {readFileSync} from 'node:fs'; const value=JSON.parse(readFileSync(new URL('./data.json',import.meta.url),'utf8')).version;`)
    .replace('app: {},',"watch:['data.json'],app: {},");
  await f.write('cormi.config.ts',source);const dev=cli(t,f.root,'dev');
  try {
    await waitFile(join(f.root,'initializing.flag'));await f.write('data.json','{"version":"new"}');await f.write('release.flag','yes');
    const ready=await dev.waitFor(e=>e.type==='ready');assert.equal(await (await fetch(new URL('version',ready.url))).text(),'new');
    assert.ok(dev.events.some(e=>e.type==='superseded'&&e.phase==='before-ready'));
    assert.equal(await dev.stop(),0);await cleanLauncher(f.root);
  }finally{await writeFile(join(f.root,'release.flag'),'yes');}
});

test('one-shot commands that change their own configuration are not replayed', {timeout:15000}, async t=>{
  const f=await app(t);
  await f.write('cormi.config.ts',`import {appendFileSync,writeFileSync} from 'node:fs';
export default {plugins:[{id:'once',plugin:{inject:['commands'],apply(ctx){ctx.effect(()=>ctx.commands.register('once',async()=>{
appendFileSync('executed.log','once\\n');writeFileSync('cormi.config.ts','export default {};');return{kind:'result',data:'completed'};
}));}}}]};`);
  const once=cli(t,f.root,'once');assert.equal(await once.finish(),0);
  assert.equal(await readFile(join(f.root,'executed.log'),'utf8'),'once\n');
  assert.equal(once.events.filter(e=>e.type==='result').length,1);await cleanLauncher(f.root);
});
