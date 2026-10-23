import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const requestConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { appRuntimePlugin, requestPlugin } from '@cormijs/plugin-react';
export default defineConfig({
  presets: [preset],
  plugins: [
    { id: 'app-runtime', plugin: appRuntimePlugin },
    { id: 'request', plugin: requestPlugin, options: { id: 'application:request' } },
  ],
  app: { base: '/request/', server: { port: 0 } },
});
`;

export async function writeRequestFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html><head><title>cormi request</title><link rel="icon" href="data:," /></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': requestConfiguration,
    'src/app.tsx': `import { defineApp } from '@cormijs/runtime';
export default defineApp({ request: { baseURL: '/api', headers: { 'x-app': 'cormi' }, timeout: 2000, cacheLimit: 1 } });`,
    'src/pages/index.tsx': `import { useRef, useState } from 'react';
import { Link, createRequestClient, useCursorPagination, usePagination, useRequest, useRequestClient } from '@cormijs/runtime';
const persistedClient=createRequestClient({baseURL:'/api',cachePersist:'session',cachePersistKey:'demo:request-cache',cacheLimit:4});
function Auto(){
  const {data,loading,error,refresh}=useRequest<{message:string}>((client,signal)=>client.get('/hello',{signal,params:{q:'one'}}));
  return <section data-auto-section><p data-auto>{data?.message ?? ''}</p><p data-loading>{String(loading)}</p><p data-error>{error ? 'error' : ''}</p><button onClick={()=>void refresh()}>Refresh</button></section>;
}
function Manual(){
  const {data,loading,error,run,cancel}=useRequest<{message:string}>((client,signal)=>client.get('/slow',{signal}),{manual:true});
  return <section data-manual-section><p data-manual>{data?.message ?? ''}</p><p data-manual-loading>{String(loading)}</p><p data-manual-error>{error ? 'error' : ''}</p><button onClick={()=>void run()}>Run slow</button><button onClick={cancel}>Cancel slow</button></section>;
}
function Failure(){
  const {data,error,run}=useRequest<{message:string}>((client,signal)=>client.get('/error',{signal}),{manual:true});
  return <section><p data-failure-data>{data?.message ?? ''}</p><p data-failure>{error instanceof Error ? error.message : ''}</p><button onClick={()=>void run()}>Run error</button></section>;
}
function Race(){
  const target=useRef('first');
  const {data,run}=useRequest<{message:string}>((client,signal)=>client.get('/slow?id='+target.current,{signal}),{manual:true});
  return <section><p data-race>{data?.message ?? ''}</p><button onClick={()=>{target.current='first';void run();}}>Run first</button><button onClick={()=>{target.current='second';void run();}}>Run second</button></section>;
}
function Retry(){
  const {data,error}=useRequest<{message:string}>((client,signal)=>client.get('/flaky',{signal}),{retry:2,retryDelay:10});
  return <section><p data-retry>{data?.message ?? ''}</p><p data-retry-error>{error ? 'error' : ''}</p></section>;
}
function Polling(){
  const {data}=useRequest<{message:string}>((client,signal)=>client.get('/poll',{signal}),{pollingInterval:150});
  return <p data-poll>{data?.message ?? ''}</p>;
}
function Paged(){
  const {data,page,hasMore,loading,loadMore,reload}=usePagination<{id:number}>((client,{page,pageSize,signal})=>client.get<{list:{id:number}[];total:number}>('/page',{signal,params:{page,pageSize}}),{pageSize:2});
  return <section><p data-page>{page}</p><p data-page-count>{data.length}</p><p data-page-more>{String(hasMore)}</p><p data-page-loading>{String(loading)}</p>
    <ul data-page-list>{data.map(item=><li key={item.id}>{item.id}</li>)}</ul>
    <button onClick={()=>void loadMore()}>More</button><button onClick={()=>void reload()}>Reload page</button></section>;
}
function Cached(){
  const client=useRequestClient();
  const [messages,setMessages]=useState<string[]>([]);
  const load=()=>void Promise.all([
    client.get<{message:string}>('/cached',{cacheTime:5000}),
    client.get<{message:string}>('/cached',{cacheTime:5000}),
  ]).then(list=>setMessages(list.map(item=>item.message)));
  return <section><p data-cached>{messages.join(',')}</p>
    <button onClick={load}>Run cached</button>
    <button onClick={()=>void client.get<{message:string}>('/cached',{cacheTime:5000,cacheBust:true}).then(item=>setMessages(value=>[...value,item.message]))}>Bust cache</button></section>;
}
function Persisted(){
  const [message,setMessage]=useState('');
  return <section><p data-persisted>{message}</p>
    <button onClick={()=>void persistedClient.get<{message:string}>('/persisted',{cacheTime:60000}).then(item=>setMessage(item.message))}>Load persisted</button>
    <button onClick={()=>{persistedClient.invalidateCache();}}>Invalidate persisted</button></section>;
}
function Tagged(){
  const client=useRequestClient();
  const [log,setLog]=useState(''), [invalidated,setInvalidated]=useState('');
  const call=(n:number)=>void client.get<{message:string}>('/tagged',{cacheTime:5000,cacheTags:['group'],params:{n}}).then(item=>setLog(value=>value+item.message+';'));
  return <section><p data-tagged>{log}</p><p data-invalidated>{invalidated}</p>
    <button onClick={()=>call(1)}>Tag 1</button>
    <button onClick={()=>call(1)}>Tag 1 again</button>
    <button onClick={()=>setInvalidated(String(client.invalidateCache(['group'])))}>Invalidate tags</button>
    <button onClick={()=>call(2)}>Tag 2</button>
    <button onClick={()=>call(1)}>Tag 1 third</button></section>;
}
function Debounced(){
  const {data,loading,run}=useRequest<{message:string}>((client,signal)=>client.get('/debounced',{signal}),{manual:true,debounceWait:120});
  return <section><p data-debounced>{data?.message ?? ''}</p><p data-debounced-loading>{String(loading)}</p>
    <button onClick={()=>{void run();void run();}}>Run debounced</button></section>;
}
function DebouncedMax(){
  const {data,run}=useRequest<{message:string}>((client,signal)=>client.get('/debounced-max',{signal}),{manual:true,debounceWait:500,debounceMaxWait:300});
  return <section><p data-debounced-max>{data?.message ?? ''}</p>
    <button onClick={()=>{void run();setTimeout(()=>{void run();},100);setTimeout(()=>{void run();},200);}}>Run debounce max</button></section>;
}
function DebouncedEdges(){
  const {data,run}=useRequest<{message:string}>((client,signal)=>client.get('/debounced-edges',{signal}),{manual:true,debounceWait:200,debounceLeading:true,debounceTrailing:true});
  return <section><p data-debounced-edges>{data?.message ?? ''}</p>
    <button onClick={()=>{void run();setTimeout(()=>{void run();},50);}}>Run debounce edges</button></section>;
}
function DebouncedLeadingOnly(){
  const {data,run}=useRequest<{message:string}>((client,signal)=>client.get('/debounced-leading-only',{signal}),{manual:true,debounceWait:200,debounceLeading:true,debounceTrailing:false});
  return <section><p data-debounced-leading-only>{data?.message ?? ''}</p>
    <button onClick={()=>{void run();void run();}}>Run debounce leading only</button></section>;
}
function Throttled(){
  const {data,run}=useRequest<{message:string}>((client,signal)=>client.get('/throttled',{signal}),{manual:true,throttleWait:200});
  return <section><p data-throttled>{data?.message ?? ''}</p>
    <button onClick={()=>{void run();void run();}}>Run throttled</button></section>;
}
function TrailingThrottled(){
  const {data,run}=useRequest<{message:string}>((client,signal)=>client.get('/throttled-trailing',{signal}),{manual:true,throttleWait:200,throttleTrailing:true});
  return <section><p data-trailing>{data?.message ?? ''}</p>
    <button onClick={()=>{void run();setTimeout(()=>{void run();},50);}}>Run trailing</button></section>;
}
function TrailingOnly(){
  const {data,run}=useRequest<{message:string}>((client,signal)=>client.get('/throttled-trailing-only',{signal}),{manual:true,throttleWait:200,throttleLeading:false,throttleTrailing:true});
  return <section><p data-trailing-only>{data?.message ?? ''}</p>
    <button onClick={()=>{void run();void run();}}>Run trailing only</button></section>;
}
function CursorPaged(){
  const {data,nextCursor,hasMore,loading,loadMore,reload}=useCursorPagination<{id:number}>((client,{cursor,signal})=>client.get<{list:{id:number}[];nextCursor:string|null}>('/cursor',{signal,params:cursor?{cursor}:{}}));
  return <section><p data-cursor-next>{nextCursor ?? 'null'}</p><p data-cursor-count>{data.length}</p><p data-cursor-more>{String(hasMore)}</p><p data-cursor-loading>{String(loading)}</p>
    <ul data-cursor-list>{data.map(item=><li key={item.id}>{item.id}</li>)}</ul>
    <button onClick={()=>void loadMore()}>More cursor</button><button onClick={()=>void reload()}>Reload cursor</button></section>;
}
function Deps(){
  const [q,setQ]=useState('one');
  const {data}=useRequest<{message:string}>((client,signal)=>client.get('/deps',{signal,params:{q}}),{refreshDeps:[q]});
  return <section><p data-deps>{data?.message ?? ''}</p><button onClick={()=>setQ('two')}>Change dep</button></section>;
}
export default function Home(){return <main><h1>Request home</h1><Auto /><Manual /><Failure /><Race /><Retry /><Polling /><Paged /><Cached /><Tagged /><Debounced /><DebouncedMax /><DebouncedEdges /><DebouncedLeadingOnly /><Throttled /><TrailingThrottled /><TrailingOnly /><Persisted /><CursorPaged /><Deps /><Link to="/other">Other</Link></main>;}`,
    'src/pages/other.tsx': `import { Link } from '@cormijs/runtime';
export default function Other(){return <main><h1>Request other</h1><Link to="/">Request home</Link></main>;}`,
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyRequestPage(page: Page, url: string) {
  let helloCount = 0, seenHeader = '', slowCount = 0, flakyCount = 0, pollCount = 0, depsCount = 0, cachedCount = 0;
  const taggedCounts: Record<string, number> = {};
  let debouncedCount = 0, debouncedMaxCount = 0, debouncedEdgesCount = 0, debouncedLeadingOnlyCount = 0, throttledCount = 0, trailingCount = 0, trailingOnlyCount = 0, persistedCount = 0;
  await page.route('**/api/**', async route => {
    const request = route.request(), target = new URL(request.url());
    seenHeader = request.headers()['x-app'] ?? '';
    if (target.pathname === '/api/hello') {
      helloCount++;
      await new Promise(resolve => setTimeout(resolve, 30));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'hello:' + (target.searchParams.get('q') ?? '') }) });
    } else if (target.pathname === '/api/slow') {
      slowCount++;
      await new Promise(resolve => setTimeout(resolve, 300));
      try { await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: target.searchParams.get('id') ?? 'slow' }) }); }
      catch { /* the useRequest generation may have aborted this request */ }
    } else if (target.pathname === '/api/error') {
      await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'failed' }) });
    } else if (target.pathname === '/api/flaky') {
      flakyCount++;
      if (flakyCount < 3) await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'flaky' }) });
      else await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'ok' }) });
    } else if (target.pathname === '/api/poll') {
      pollCount++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'poll:' + pollCount }) });
    } else if (target.pathname === '/api/debounced-max') {
      debouncedMaxCount++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'debounced-max:' + debouncedMaxCount }) });
    } else if (target.pathname === '/api/debounced-edges') {
      debouncedEdgesCount++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'debounced-edges:' + debouncedEdgesCount }) });
    } else if (target.pathname === '/api/debounced-leading-only') {
      debouncedLeadingOnlyCount++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'debounced-leading-only:' + debouncedLeadingOnlyCount }) });
    } else if (target.pathname === '/api/throttled') {
      throttledCount++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'throttled:' + throttledCount }) });
    } else if (target.pathname === '/api/debounced') {
      debouncedCount++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'debounced:' + debouncedCount }) });
    } else if (target.pathname === '/api/throttled-trailing') {
      trailingCount++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'throttled-trailing:' + trailingCount }) });
    } else if (target.pathname === '/api/throttled-trailing-only') {
      trailingOnlyCount++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'throttled-trailing-only:' + trailingOnlyCount }) });
    } else if (target.pathname === '/api/tagged') {
      const n = target.searchParams.get('n') ?? '0';
      taggedCounts[n] = (taggedCounts[n] ?? 0) + 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'tagged:' + taggedCounts[n] }) });
    } else if (target.pathname === '/api/persisted') {
      persistedCount++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'persisted:' + persistedCount }) });
    } else if (target.pathname === '/api/cached') {
      cachedCount++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'cached:' + cachedCount }) });
    } else if (target.pathname === '/api/cursor') {
      const offset = Number(target.searchParams.get('cursor') ?? '0'), end = Math.min(offset + 2, 5);
      const list = Array.from({ length: 5 }, (_, index) => ({ id: index + 1 })).slice(offset, end);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ list, nextCursor: end < 5 ? String(end) : null }) });
    } else if (target.pathname === '/api/page') {
      const page = Number(target.searchParams.get('page') ?? '1'), pageSize = Number(target.searchParams.get('pageSize') ?? '2');
      const list = Array.from({ length: 5 }, (_, index) => ({ id: index + 1 })).slice((page - 1) * pageSize, page * pageSize);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ list, total: 5 }) });
    } else if (target.pathname === '/api/deps') {
      depsCount++;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ message: 'deps:' + (target.searchParams.get('q') ?? '') }) });
    } else {
      await route.fulfill({ status: 404, body: 'missing' });
    }
  });
  await page.goto(url); await page.getByRole('heading', { name: 'Request home', exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('[data-auto]')?.textContent === 'hello:one');
  assert.equal(seenHeader, 'cormi');
  assert.equal(await page.locator('[data-loading]').innerText(), 'false');
  assert.equal(helloCount, 1);
  const refreshed = page.waitForResponse(response => response.url().includes('/api/hello'));
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await refreshed;
  await page.waitForFunction(() => document.querySelector('[data-loading]')?.textContent === 'false');
  assert.equal(helloCount, 2);

  await page.getByRole('button', { name: 'Run slow', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-manual-loading]')?.textContent === 'true');
  await page.getByRole('button', { name: 'Cancel slow', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-manual-loading]')?.textContent === 'false');
  assert.equal(await page.locator('[data-manual]').innerText(), '');
  assert.equal(await page.locator('[data-manual-error]').innerText(), '');

  await page.getByRole('button', { name: 'Run error', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-failure]')?.textContent?.includes('500'));
  assert.equal(await page.locator('[data-failure-data]').innerText(), '');

  await page.getByRole('button', { name: 'Run first', exact: true }).click();
  await page.waitForTimeout(40);
  await page.getByRole('button', { name: 'Run second', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-race]')?.textContent === 'second');
  assert.ok(slowCount >= 2);
  await page.waitForFunction(() => document.querySelector('[data-retry]')?.textContent === 'ok');
  assert.equal(flakyCount, 3);
  assert.equal(await page.locator('[data-retry-error]').innerText(), '');
  await page.waitForTimeout(500);
  assert.ok(pollCount >= 2, `polled ${pollCount} times`);
  await page.waitForFunction(() => document.querySelector('[data-cursor-count]')?.textContent === '2');
  await page.getByRole('button', { name: 'More cursor', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-cursor-count]')?.textContent === '4');
  await page.getByRole('button', { name: 'More cursor', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-cursor-count]')?.textContent === '5');
  assert.equal(await page.locator('[data-cursor-more]').innerText(), 'false');
  await page.getByRole('button', { name: 'More cursor', exact: true }).click();
  assert.equal(await page.locator('[data-cursor-count]').innerText(), '5');
  await page.getByRole('button', { name: 'Reload cursor', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-cursor-count]')?.textContent === '2');
  assert.equal(await page.locator('[data-cursor-next]').innerText(), '2');
  await page.waitForFunction(() => document.querySelector('[data-page-count]')?.textContent === '2');
  assert.equal(await page.locator('[data-page]').innerText(), '1');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-page-count]')?.textContent === '4');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-page-count]')?.textContent === '5');
  assert.equal(await page.locator('[data-page]').innerText(), '3');
  assert.equal(await page.locator('[data-page-more]').innerText(), 'false');
  await page.getByRole('button', { name: 'More', exact: true }).click();
  assert.equal(await page.locator('[data-page-count]').innerText(), '5');
  await page.getByRole('button', { name: 'Reload page', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-cursor-count]')?.textContent === '2');
  await page.getByRole('button', { name: 'More cursor', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-cursor-count]')?.textContent === '4');
  await page.getByRole('button', { name: 'More cursor', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-cursor-count]')?.textContent === '5');
  assert.equal(await page.locator('[data-cursor-more]').innerText(), 'false');
  await page.getByRole('button', { name: 'More cursor', exact: true }).click();
  assert.equal(await page.locator('[data-cursor-count]').innerText(), '5');
  await page.getByRole('button', { name: 'Reload cursor', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-cursor-count]')?.textContent === '2');
  assert.equal(await page.locator('[data-cursor-next]').innerText(), '2');
  await page.waitForFunction(() => document.querySelector('[data-page-count]')?.textContent === '2');
  assert.equal(await page.locator('[data-page]').innerText(), '1');
  assert.equal(await page.locator('[data-page-more]').innerText(), 'true');
  await page.getByRole('button', { name: 'Run cached', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-cached]')?.textContent === 'cached:1,cached:1');
  assert.equal(cachedCount, 1, 'concurrent GETs share one request');
  await page.getByRole('button', { name: 'Run cached', exact: true }).click();
  await page.waitForTimeout(100);
  assert.equal(cachedCount, 1, 'cached GET does not refetch');
  await page.getByRole('button', { name: 'Bust cache', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-cached]')?.textContent?.endsWith('cached:2'));
  assert.equal(cachedCount, 2);
  await page.getByRole('button', { name: 'Tag 1', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-tagged]')?.textContent === 'tagged:1;');
  await page.getByRole('button', { name: 'Tag 1 again', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-tagged]')?.textContent === 'tagged:1;tagged:1;');
  assert.equal(taggedCounts['1'], 1, 'tagged GET cache hit');
  await page.getByRole('button', { name: 'Invalidate tags', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-invalidated]')?.textContent === '1');
  await page.getByRole('button', { name: 'Tag 1 third', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-tagged]')?.textContent?.endsWith('tagged:2;'));
  assert.equal(taggedCounts['1'], 2, 'tag invalidation forces refetch');
  await page.getByRole('button', { name: 'Tag 2', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-tagged]')?.textContent?.endsWith('tagged:1;'));
  await page.getByRole('button', { name: 'Tag 1 third', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-tagged]')?.textContent?.endsWith('tagged:3;'));
  assert.equal(taggedCounts['1'], 3, 'cacheLimit evicts the oldest entry');
  await page.getByRole('button', { name: 'Run debounced', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-debounced]')?.textContent === 'debounced:1');
  await page.waitForTimeout(200);
  assert.equal(debouncedCount, 1, 'debounceWait coalesces rapid runs');
  await page.getByRole('button', { name: 'Run debounce max', exact: true }).click();
  await page.waitForTimeout(450);
  assert.equal(debouncedMaxCount, 1, 'debounceMaxWait flushes before the trailing wait');
  await page.waitForTimeout(400);
  assert.equal(debouncedMaxCount, 1, 'maxWait executes the coalesced burst once');
  await page.waitForFunction(() => document.querySelector('[data-debounced-max]')?.textContent === 'debounced-max:1');
  await page.getByRole('button', { name: 'Run debounce edges', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-debounced-edges]')?.textContent === 'debounced-edges:1');
  assert.equal(debouncedEdgesCount, 1, 'leading edge executes immediately');
  await page.waitForFunction(() => document.querySelector('[data-debounced-edges]')?.textContent === 'debounced-edges:2');
  assert.equal(debouncedEdgesCount, 2, 'trailing edge coalesces the second call');
  await page.getByRole('button', { name: 'Run debounce leading only', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(debouncedLeadingOnlyCount, 1, 'trailing=false drops calls within the leading window');
  await page.waitForFunction(() => document.querySelector('[data-debounced-leading-only]')?.textContent === 'debounced-leading-only:1');
  await page.getByRole('button', { name: 'Run throttled', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-throttled]')?.textContent === 'throttled:1');
  assert.equal(throttledCount, 1, 'throttleWait drops the immediate second call');
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: 'Run throttled', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-throttled]')?.textContent === 'throttled:2');
  assert.equal(throttledCount, 2);
  await page.getByRole('button', { name: 'Run trailing', exact: true }).click();
  assert.equal(trailingCount, 1, 'leading call runs immediately');
  await page.waitForFunction(() => document.querySelector('[data-trailing]')?.textContent === 'throttled-trailing:2');
  assert.equal(trailingCount, 2, 'the dropped call runs once at the window end');
  await page.getByRole('button', { name: 'Run trailing only', exact: true }).click();
  assert.equal(trailingOnlyCount, 0, 'leading can be disabled');
  await page.waitForFunction(() => document.querySelector('[data-trailing-only]')?.textContent === 'throttled-trailing-only:1');
  assert.equal(trailingOnlyCount, 1, 'coalesced trailing calls execute once');
  await page.waitForFunction(() => document.querySelector('[data-deps]')?.textContent === 'deps:one');
  await page.getByRole('button', { name: 'Change dep', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-deps]')?.textContent === 'deps:two');
  assert.ok(depsCount >= 2);
  await page.getByRole('button', { name: 'Load persisted', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-persisted]')?.textContent === 'persisted:1');
  assert.equal(persistedCount, 1);
  await page.reload();
  await page.getByRole('heading', { name: 'Request home', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Load persisted', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-persisted]')?.textContent === 'persisted:1');
  assert.equal(persistedCount, 1, 'sessionStorage cache survives a reload');
  await page.getByRole('button', { name: 'Invalidate persisted', exact: true }).click();
  await page.getByRole('button', { name: 'Load persisted', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-persisted]')?.textContent === 'persisted:2');
  assert.equal(persistedCount, 2, 'invalidateCache removes the persisted entry');
  await page.getByRole('link', { name: 'Other', exact: true }).click();
  await page.getByRole('heading', { name: 'Request other', exact: true }).waitFor();
  await page.waitForTimeout(200);
  const stoppedAt = pollCount;
  await page.waitForTimeout(400);
  assert.equal(pollCount, stoppedAt, 'polling stops after unmount');
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
  await page.unroute('**/api/**');
}
