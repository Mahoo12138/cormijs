import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const modelConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { modelPlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'application-model', plugin: modelPlugin, options: { id: 'application:model' } }],
  app: { base: '/models/', server: { port: 0 } },
});
`;

export async function writeModelFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await mkdir(join(root, 'src/models'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi models</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': modelConfiguration,
    'src/models/counter.ts': `import { useState } from 'react';
export default function counter(){const [count,setCount]=useState(0);return {count,increment:()=>setCount(value=>value+1)};}`,
    'src/models/user.ts': `import { useState } from 'react';
export default function user(){const [name,setName]=useState('Ada');return {name,rename:(value:string)=>setName(value)};}`,
    'src/pages/index.tsx': `import { useModel } from '@cormijs/runtime';
import { Link } from '@cormijs/runtime';
function CounterView(){const {count,increment}=useModel<{count:number;increment:()=>void}>('counter');return <section data-counter>{count}<button onClick={increment}>Increment</button></section>;}
function CounterSelector(){const count=useModel('counter',(state:{count:number})=>state.count);return <output data-count>{count}</output>;}
function UserView(){const {name,rename}=useModel<{name:string;rename:(value:string)=>void}>('user');return <section data-user>{name}<button onClick={()=>rename('Grace')}>Rename</button></section>;}
export default function Home(){return <main><h1>Model home</h1><CounterView /><CounterSelector /><UserView /><Link to="/other">Other page</Link></main>;}`,
    'src/pages/other.tsx': `import { Link, useModel } from '@cormijs/runtime';
export default function Other(){const count=useModel('counter',(state:{count:number})=>state.count);return <main><h1>Model other</h1><output data-other-count>{count}</output><Link to="/">Model home</Link></main>;}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyModelPage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'Model home', exact: true }).waitFor();
  assert.equal(await page.locator('[data-counter]').innerText(), '0Increment');
  assert.equal(await page.locator('[data-count]').innerText(), '0');
  assert.equal(await page.locator('[data-user]').innerText(), 'AdaRename');
  await page.getByRole('button', { name: 'Increment', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-count]')?.textContent === '1');
  assert.match(await page.locator('[data-counter]').innerText(), /^1/);
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-user]')?.textContent?.startsWith('Grace'));
  await page.getByRole('link', { name: 'Other page', exact: true }).click();
  await page.getByRole('heading', { name: 'Model other', exact: true }).waitFor();
  assert.equal(await page.locator('[data-other-count]').innerText(), '1');
  await page.getByRole('link', { name: 'Model home', exact: true }).click();
  await page.getByRole('heading', { name: 'Model home', exact: true }).waitFor();
  assert.equal(await page.locator('[data-count]').innerText(), '1');
  await page.reload(); await page.getByRole('heading', { name: 'Model home', exact: true }).waitFor();
  assert.equal(await page.locator('[data-count]').innerText(), '0');
  assert.equal(await page.locator('[data-user]').innerText(), 'AdaRename');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
