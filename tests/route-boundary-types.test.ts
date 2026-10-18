import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { app, cli } from './launcher-helpers.js';

test('application typecheck rejects a non-component or missing boundary export even when generated files are excluded',{timeout:60000},async t=>{
  const f=await app(t);await mkdir(join(f.root,'src'),{recursive:true});
  await f.write('index.html','<div id="root"></div><script type="module" src="/.cormi/app.tsx"></script>');
  await f.write('tsconfig.json',JSON.stringify({compilerOptions:{target:'ES2023',module:'ESNext',moduleResolution:'Bundler',jsx:'react-jsx',strict:true,skipLibCheck:true,noEmit:true},include:['src'],exclude:['.cormi']}));
  await f.write('cormi.config.ts',`import {defineConfig} from 'cormijs';import preset from '@cormijs/preset-react-vite';export default defineConfig({presets:[preset],app:{routes:[{id:'root',path:'',errorBoundary:{specifier:'./src/Boundary.tsx',exportName:'Boundary'},source:{}}]}});`);
  for(const source of ['export const Boundary=42;','export default function Other(){return null;}']) {
    await f.write('src/Boundary.tsx',source);const child=cli(t,f.root,'typecheck',['--startup-timeout','30000']);
    assert.equal(await child.finish(30000),1);assert.ok(child.events.some(event=>event.code==='TYPECHECK_FAILED'),JSON.stringify(child.events)+child.stderr);
  }
  await f.write('src/Boundary.tsx','export function Boundary(){return null;}');
  const valid=cli(t,f.root,'typecheck',['--startup-timeout','30000']);assert.equal(await valid.finish(30000),0,JSON.stringify(valid.events)+valid.stderr);
});
