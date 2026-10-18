import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { DevApiSession, validateDevApi, type DevApiOptions } from '@cormijs/plugin-dev-api';
import { ProjectRuntime } from '@cormijs/core';
import { vitePlugin } from '@cormijs/plugin-vite';
import { devApiVitePlugin } from '@cormijs/plugin-dev-api/vite';
import { listen, close, fixture, assertPortFree, gate, hasCode } from './helpers.js';

async function api(t: TestContext, options: DevApiOptions = {}) {
  const session = new DevApiSession(options);
  const server = createServer((req,res)=>session.middleware(req,res,()=>{res.statusCode=418;res.end('next');}));
  const port = await listen(server);
  t.after(async()=>{try{await session.close();}finally{await close(server);}});
  return {session,url:`http://127.0.0.1:${port}`,port};
}
const echo = {method:'POST',path:'/echo',handle:({body}: import('@cormijs/plugin-dev-api').MockRequest)=>({body})};
const ok = {method:'GET',path:'/hello',handle:()=>({body:{ok:true}})};
const timeout = {timeout:10000};
test('development API validates namespace, duplicates, unknown options and fixed proxy targets',()=>{
  for(const config of [{prefix:'/'},{prefix:'/@fs'},{timeoutMs:0},{maxBodyBytes:Infinity},{unknown:true},{proxies:[{path:'/x',target:'file:///etc/passwd'}]},{proxies:[{path:'/x',target:'http://user:pass@localhost'}]},{proxies:[{path:'/x',target:'http://localhost/?target=x'}]}]) assert.throws(()=>validateDevApi(config as DevApiOptions),hasCode('DEV_API_CONFIG_INVALID'));
  assert.throws(()=>validateDevApi({mocks:[ok,ok]}),hasCode('DEV_API_RULE_CONFLICT'));
  assert.throws(()=>validateDevApi({proxies:[{path:'/x',target:'http://localhost'},{path:'/x',target:'http://localhost'}]}),hasCode('DEV_API_RULE_CONFLICT'));
  const rules: import('@cormijs/plugin-dev-api').MockRule[]=[ok]; const config=validateDevApi({mocks:rules}); rules.push(echo); assert.equal(config.mocks.length,1); assert.ok(Object.isFrozen(config.mocks));
});
test('exact Mock methods, JSON body and repeated query data preserve Unicode; HEAD has no body',timeout,async t=>{
  const f=await api(t,{mocks:[ok,echo,{method:'GET',path:'/query',handle:({query})=>({body:query.getAll('name')})}]});
  assert.deepEqual(await (await fetch(f.url+'/api/hello')).json(),{ok:true});
  const response=await fetch(f.url+'/api/echo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value:'中文'})}); assert.equal(response.status,200);assert.deepEqual(await response.json(),{value:'中文'});
  assert.deepEqual(await (await fetch(f.url+'/api/query?name=a&name=%E4%B8%AD')).json(),['a','中']);
  const head=await fetch(f.url+'/api/hello',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  assert.equal((await fetch(f.url+'/apix/hello')).status,418); assert.equal((await fetch(f.url+'/api/missing')).status,404);
});
test('invalid and oversized bodies and foreign Origin fail without invoking a Mock',timeout,async t=>{
  let calls=0; const f=await api(t,{maxBodyBytes:12,mocks:[{...echo,handle:()=>{calls++;return {body:true};}}]});
  const send=(body:string,type='application/json',origin?:string)=>fetch(f.url+'/api/echo',{method:'POST',headers:{'content-type':type,...(origin?{origin}:{})},body});
  assert.equal((await send('{')).status,400);assert.equal((await send('{}','text/plain')).status,415);assert.equal((await send('"'+ 'x'.repeat(20)+'"')).status,413);
  assert.equal((await send('{}','application/json','https://foreign.invalid')).status,403);assert.equal(calls,0);
  assert.equal((await send('{}','application/json',f.url)).status,200);assert.equal(calls,1);
});
test('mock failure, invalid replies and response budgets never expose exception text',timeout,async t=>{
  const f=await api(t,{maxResponseBytes:20,mocks:[{...ok,handle:()=>{throw new Error('PRIVATE-MOCK-SECRET');}},{method:'GET',path:'/large',handle:()=>({body:'x'.repeat(100)})},{method:'GET',path:'/invalid',handle:()=>({status:999})}]});
  for(const path of ['hello','large','invalid']) {const r=await fetch(f.url+'/api/'+path);assert.equal(r.status,500);assert.doesNotMatch(await r.text(),/PRIVATE-MOCK-SECRET|node_modules|Error:/);}
});
test('fixed-target proxy forwards path/query/body and cookies, strips hop headers, and does not follow redirects',timeout,async t=>{
  let calls=0;
  const upstream=createServer((req,res)=>{calls++; const parts:Buffer[]=[];req.on('data',p=>parts.push(p));req.on('end',()=>{
    if(req.url==='/v1/redirect'){res.writeHead(302,{location:'/v1/other'});res.end();return;}
    res.setHeader('connection','x-private');res.setHeader('x-private','remove-me');res.setHeader('set-cookie',['one=1; Path=/','two=2; Path=/']);
    res.end(JSON.stringify({url:req.url,method:req.method,host:req.headers.host,body:Buffer.concat(parts).toString(),removed:req.headers['x-remove']??null}));
  });});
  const port=await listen(upstream);t.after(()=>close(upstream));
  const f=await api(t,{proxies:[{path:'/backend',target:`http://127.0.0.1:${port}/v1`,stripPrefix:true}]});
  const response=await fetch(f.url+'/api/backend/items?q=%E4%B8%AD',{method:'POST',body:'binary-ish'});
  assert.equal(response.headers.get('x-private'),null);assert.deepEqual(response.headers.getSetCookie(),['one=1; Path=/','two=2; Path=/']);
  assert.deepEqual(await response.json(),{url:'/v1/items?q=%E4%B8%AD',method:'POST',host:`127.0.0.1:${port}`,body:'binary-ish',removed:null});
  const redirect=await fetch(f.url+'/api/backend/redirect',{redirect:'manual'});assert.equal(redirect.status,302);assert.equal(calls,2);
  const low=await new Promise<string>((resolve,reject)=>{const req=request(f.url+'/api/backend/check',{headers:{connection:'x-remove','x-remove':'secret'}},res=>{let text='';res.on('data',p=>text+=p);res.on('end',()=>resolve(text));});req.on('error',reject);req.end();});
  assert.equal(JSON.parse(low).removed,null);
});
test('Mock wins over matching proxy and proxy selection uses longest segment prefix',timeout,async t=>{
  const upstream=createServer((req,res)=>res.end(req.url));const port=await listen(upstream);t.after(()=>close(upstream));
  const f=await api(t,{mocks:[ok],proxies:[{path:'/',target:`http://127.0.0.1:${port}/fallback`},{path:'/deep',target:`http://127.0.0.1:${port}/specific`,stripPrefix:true}]});
  assert.deepEqual(await (await fetch(f.url+'/api/hello')).json(),{ok:true});
  assert.equal(await (await fetch(f.url+'/api/deep/item')).text(),'/specific/item');
  assert.equal(await (await fetch(f.url+'/api/deeper')).text(),'/fallback/deeper');
});
test('proxy connection failure, oversized response and timeout are bounded and do not leak targets',timeout,async t=>{
  const upstream=createServer((req,res)=>{if(req.url==='/large')res.end('x'.repeat(100));});const port=await listen(upstream);t.after(async()=>{if(upstream.listening)await close(upstream);});
  const f=await api(t,{timeoutMs:150,maxResponseBytes:12,proxies:[{path:'/',target:`http://127.0.0.1:${port}`} ]});
  assert.equal((await fetch(f.url+'/api/large')).status,502);assert.equal((await fetch(f.url+'/api/hang')).status,504);
  await close(upstream);const r=await fetch(f.url+'/api/gone');assert.equal(r.status,502);assert.doesNotMatch(await r.text(),new RegExp(String(port)));
});
test('timeout cancels cooperative Mock and close waits for admitted tasks before becoming inactive',timeout,async t=>{
  const started=gate();let cancelled=false;
  const f=await api(t,{timeoutMs:80,mocks:[{...ok,async handle({signal}){started.resolve();try{await delay(5000,undefined,{signal});}catch{cancelled=true;}return {body:'late'};}}]});
  const request=fetch(f.url+'/api/hello');await started.promise;const r=await request;assert.equal(r.status,504);await f.session.close();assert.equal(cancelled,true);assert.equal((await fetch(f.url+'/api/hello')).status,418);
});
test('closing an active session returns 503, releases cooperative work and is idempotent',timeout,async t=>{
  const started=gate();let stopped=false;
  const f=await api(t,{mocks:[{...ok,async handle({signal}){started.resolve();try{await delay(5000,undefined,{signal});}finally{stopped=true;}return {body:null};}}]});
  const req=fetch(f.url+'/api/hello');await started.promise;
  await Promise.all([f.session.close(),f.session.close()]);assert.equal((await req).status,503);assert.equal(stopped,true);
});
test('parallel requests and independent sessions do not share request data or rule state',timeout,async t=>{
  const first=await api(t,{mocks:[{...echo,handle:async({body})=>{await delay(2);return {body};}}]});const second=await api(t,{mocks:[{...echo,handle:()=>({body:'second'})}]});
  const values=await Promise.all(Array.from({length:40},(_,i)=>fetch(first.url+'/api/echo',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(i)}).then(r=>r.json())));assert.deepEqual(values,Array.from({length:40},(_,i)=>i));
  assert.equal(await (await fetch(second.url+'/api/echo',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).json(),'second');
});
test('non-cooperative timed-out handlers retain admission slots and close reports incomplete cleanup',timeout,async t=>{
  const entered=gate(),release=gate();let calls=0;
  const session=new DevApiSession({timeoutMs:50,maxConcurrent:1,mocks:[{...ok,async handle(){calls++;entered.resolve();await release.promise;return {body:true};}}]});
  const server=createServer((req,res)=>session.middleware(req,res,()=>res.end('next'))),port=await listen(server);
  t.after(async()=>{release.resolve();await close(server);});
  const first=fetch(`http://127.0.0.1:${port}/api/hello`);await entered.promise;assert.equal((await first).status,504);
  const denied=await fetch(`http://127.0.0.1:${port}/api/hello`);assert.equal(denied.status,503);assert.deepEqual(await denied.json(),{error:'DEV_API_BUSY'});assert.equal(calls,1);
  await assert.rejects(session.close(),hasCode('DEV_API_CLEANUP_TIMEOUT'));release.resolve();
});
test('client disconnect propagates cancellation to the admitted Mock',timeout,async t=>{
  const entered=gate(),cancelled=gate();const f=await api(t,{mocks:[{...ok,async handle({signal}){entered.resolve();try{await delay(5000,undefined,{signal});}finally{cancelled.resolve();}return {body:null};}}]});
  const req=request(f.url+'/api/hello');req.on('error',()=>{});req.end();await entered.promise;req.destroy();await cancelled.promise;await f.session.close();
});
test('closing the actual Vite handle cancels an in-flight Mock and drains the session',timeout,async()=>{
  const f=await fixture(),h=new ProjectRuntime(),entered=gate(),cancelled=gate();h.mount('vite',vitePlugin);
  h.mount('api',devApiVitePlugin,{timeoutMs:10000,mocks:[{...ok,async handle({signal}){entered.resolve();try{await delay(10000,undefined,{signal});}finally{cancelled.resolve();}return {body:true};}}]});
  try{await h.ready();const dev=await h.ctx.builder.dev(f.plan);const response=fetch(new URL('/api/hello',dev.url)).then(async r=>({status:r.status,text:await r.text()}),()=>({status:0,text:'connection closed'}));
    await entered.promise;const started=Date.now();await dev.close();assert.ok(Date.now()-started<4000,'close must cancel the handler rather than waiting its full timeout');await cancelled.promise;const result=await response;assert.ok([0,503].includes(result.status));await assertPortFree(Number(new URL(dev.url).port));
  }finally{await h.dispose();await f.clean();}
});
test('Mock media type matching is exact rather than a JSON prefix test',timeout,async t=>{
  let calls=0;const f=await api(t,{mocks:[{...echo,handle:()=>{calls++;return {body:true};}}]});
  const wrong=await fetch(f.url+'/api/echo',{method:'POST',headers:{'content-type':'application/jsonp'},body:'{}'});
  assert.equal(wrong.status,415);assert.equal(calls,0);
  const right=await fetch(f.url+'/api/echo',{method:'POST',headers:{'content-type':'application/json; charset=utf-8'},body:'{}'});
  assert.equal(right.status,200);assert.equal(calls,1);
});
test('proxy preserves encoded reserved path characters and query instead of decoding the upstream identifier',timeout,async t=>{
  const upstream=createServer((req,res)=>res.end(req.url)),port=await listen(upstream);t.after(()=>close(upstream));
  const f=await api(t,{proxies:[{path:'/backend',target:`http://127.0.0.1:${port}/v1`,stripPrefix:true}]});
  const response=await fetch(f.url+'/api/backend/a%2Fb/%25/%E4%B8%AD?q=%2F&plus=a+b');
  assert.equal(response.status,200);assert.equal(await response.text(),'/v1/a%2Fb/%25/%E4%B8%AD?q=%2F&plus=a+b');
});
test('Vite bridge handles dev only; build/preview do not retain a Mock endpoint',timeout,async()=>{
  const f=await fixture(),h=new ProjectRuntime();h.mount('vite',vitePlugin);h.mount('api',devApiVitePlugin,{mocks:[ok]});
  try{await h.ready();const dev=await h.ctx.builder.dev(f.plan);assert.deepEqual(await (await fetch(new URL('/api/hello',dev.url))).json(),{ok:true});const port=Number(new URL(dev.url).port);await dev.close();await assertPortFree(port);
    await h.ctx.builder.build(f.plan);const preview=await h.ctx.builder.preview(f.plan);const r=await fetch(new URL('/api/hello',preview.url));assert.doesNotMatch(await r.text(),/"ok":true/);await preview.close();
  }finally{await h.dispose();await f.clean();}
});
