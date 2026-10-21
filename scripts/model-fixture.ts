import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const modelConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { modelPlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [{ id: 'application-model', plugin: modelPlugin, options: { id: 'application:model', extraModels: ['src/extra/boost.ts'] } }],
  app: { base: '/models/', server: { port: 0 } },
});
`;

export async function writeModelFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await mkdir(join(root, 'src/models'), { recursive: true });
  await mkdir(join(root, 'src/extra'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi models</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': modelConfiguration,
    'src/models/counter.ts': `import { useState } from 'react';
export default function counter(){const [count,setCount]=useState(0);return {count,increment:()=>setCount(value=>value+1)};}`,
    'src/models/user.ts': `import { useState } from 'react';
export default function user(){const [name,setName]=useState('Ada');return {name,rename:(value:string)=>setName(value)};}`,
    'src/models/cart.ts': `import { defineModel } from '@cormijs/runtime';
export default defineModel({
  state: { items: [] as string[], total: 0 },
  dependencies: ['prefs'],
  reducers: {
    add(state, action) { return { items: [...state.items, String(action.payload)], total: state.total + 1 }; },
  },
  effects: {
    async addLater(action, { put, call }) {
      await call((ms: number) => new Promise(resolve => setTimeout(resolve, ms)), 5);
      await put({ type: 'add', payload: action.payload });
    },
    async crossAdd(action, { put }) {
      await put({ type: 'prefs/touch', payload: action.payload });
    },
  },
  subscriptions: { boot({ dispatch }) { void dispatch({ type: 'audit/record', payload: 'cart' }); } },
});`,
    'src/models/prefs.ts': `import { defineModel } from '@cormijs/runtime';
export default defineModel({
  state: { touched: '' },
  reducers: { touch(state, action) { return { touched: String(action.payload) }; } },
  subscriptions: { boot({ dispatch }) { void dispatch({ type: 'audit/record', payload: 'prefs' }); } },
});`,
    'src/models/audit.ts': `import { defineModel } from '@cormijs/runtime';
export default defineModel({
  state: { order: '' },
  reducers: { record(state, action) { return { order: state.order ? state.order + ',' + String(action.payload) : String(action.payload) }; } },
});`,
    'src/extra/boost.ts': `import { defineModel } from '@cormijs/runtime';
export default defineModel({
  state: { booted: false },
  reducers: { mark() { return { booted: true }; } },
  subscriptions: { boot({ dispatch }) { void dispatch({ type: 'mark' }); } },
});`,    'src/pages/index.tsx': `import { useModel, useModelDispatch } from '@cormijs/runtime';
import { Link } from '@cormijs/runtime';
import { useState } from 'react';
function CounterView(){const {count,increment}=useModel<{count:number;increment:()=>void}>('counter');return <section data-counter>{count}<button onClick={increment}>Increment</button></section>;}
function CounterSelector(){const count=useModel('counter',(state:{count:number})=>state.count);return <output data-count>{count}</output>;}
function UserView(){const {name,rename}=useModel<{name:string;rename:(value:string)=>void}>('user');return <section data-user>{name}<button onClick={()=>rename('Grace')}>Rename</button></section>;}
function BoostView(){const {booted}=useModel<{booted:boolean}>('extra.boost');return <p data-boost>{String(booted)}</p>;}
function AuditView(){const {order}=useModel<{order:string}>('audit');return <p data-order>{order}</p>;}
function CartView(){
  const cart=useModel<{items:string[];total:number}>('cart');
  const prefs=useModel<{touched:string}>('prefs');
  const dispatch=useModelDispatch('cart');
  const [error,setError]=useState('');
  return <section data-cart>{cart.total}:{prefs.touched}
    <button onClick={()=>void dispatch({type:'addLater',payload:'apple'})}>Add later</button>
    <button onClick={()=>void dispatch({type:'crossAdd',payload:'x'})}>Cross add</button>
    <button onClick={()=>void dispatch({type:'missing'}).catch(value=>setError(value instanceof Error?value.message:String(value)))}>Bad action</button>
    <output data-cart-error>{error}</output>
  </section>;
}
export default function Home(){return <main><h1>Model home</h1><CounterView /><CounterSelector /><UserView /><BoostView /><AuditView /><CartView /><Link to="/other">Other page</Link></main>;}`,
    'src/pages/other.tsx': `import { Link, useModel } from '@cormijs/runtime';
export default function Other(){const count=useModel('counter',(state:{count:number})=>state.count);const cart=useModel<{total:number}>('cart');return <main><h1>Model other</h1><output data-other-count>{count}</output><output data-other-cart>{cart.total}</output><Link to="/">Model home</Link></main>;}`,
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
  assert.ok((await page.locator('[data-cart]').innerText()).startsWith('0:'));
  await page.waitForFunction(() => document.querySelector('[data-boost]')?.textContent === 'true');
  await page.waitForFunction(() => document.querySelector('[data-order]')?.textContent === 'prefs,cart');
  await page.getByRole('button', { name: 'Add later', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-cart]')?.textContent?.startsWith('1:'));
  await page.getByRole('button', { name: 'Cross add', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-cart]')?.textContent?.includes(':x'));
  await page.getByRole('button', { name: 'Bad action', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-cart-error]')?.textContent?.includes('MODEL_ACTION_NOT_FOUND'));
  await page.getByRole('button', { name: 'Increment', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-count]')?.textContent === '1');
  assert.match(await page.locator('[data-counter]').innerText(), /^1/);
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-user]')?.textContent?.startsWith('Grace'));
  await page.getByRole('link', { name: 'Other page', exact: true }).click();
  await page.getByRole('heading', { name: 'Model other', exact: true }).waitFor();
  assert.equal(await page.locator('[data-other-count]').innerText(), '1');
  assert.equal(await page.locator('[data-other-cart]').innerText(), '1');
  await page.getByRole('link', { name: 'Model home', exact: true }).click();
  await page.getByRole('heading', { name: 'Model home', exact: true }).waitFor();
  assert.equal(await page.locator('[data-count]').innerText(), '1');
  assert.ok((await page.locator('[data-cart]').innerText()).startsWith('1:x'));
  await page.reload(); await page.getByRole('heading', { name: 'Model home', exact: true }).waitFor();
  assert.equal(await page.locator('[data-count]').innerText(), '0');
  assert.equal(await page.locator('[data-user]').innerText(), 'AdaRename');
  assert.ok((await page.locator('[data-cart]').innerText()).startsWith('0:'));
  assert.equal(await page.locator('[data-cart-error]').innerText(), '');
  await page.waitForFunction(() => document.querySelector('[data-boost]')?.textContent === 'true');
  await page.waitForFunction(() => document.querySelector('[data-order]')?.textContent === 'prefs,cart');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
