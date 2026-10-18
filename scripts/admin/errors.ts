import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Page } from 'playwright-core';

// Fault injection is restricted to the reviewed Users page of an explicitly supplied migrated test copy.
// It never changes the upstream checkout, and restores only bytes that still match this test's last write.
const {values}=parseArgs({strict:true,options:{app:{type:'string'},out:{type:'string'}}});
assert.ok(values.app&&values.out,'Required --app <disposable migrated copy> --out <new evidence directory>');
const app=await realpath(values.app),out=resolve(values.out);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const migration=JSON.parse(await readFile(join(app,'migration.json'),'utf8'));
assert.equal(migration.format,'cormi:admin-migration:1');assert.equal(migration.upstream,'69e780a40c455d664b2e13c525faf1d492a072a7');
const expected=JSON.parse(await readFile(join(root,'artifacts/admin-upstream.json'),'utf8')).source_files;
const hash=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
const file=join(app,'src/pages/user.tsx'),boundary=join(app,'src/routes/components/error-boundary.tsx');
const original=await readFile(file),identity=await lstat(file);
assert.ok(identity.isFile()&&!identity.isSymbolicLink()&&identity.nlink===1&&await realpath(file)===file);
assert.equal(hash(original),expected['src/pages/user.tsx'].sha256);
assert.equal(hash(await readFile(boundary)),expected['src/routes/components/error-boundary.tsx'].sha256);
await mkdir(out);await writeFile(join(out,'original-user.tsx'),original,{flag:'wx'});
let last=original;
async function replace(bytes:Buffer|string) {
  const now=await lstat(file);assert.ok(now.isFile()&&!now.isSymbolicLink()&&now.ino===identity.ino&&now.dev===identity.dev);
  assert.deepEqual(await readFile(file),last,'Concurrent source change: do not overwrite');
  await writeFile(file,bytes);last=typeof bytes==='string'?Buffer.from(bytes):Buffer.from(bytes);
}
async function within<T>(work:Promise<T>,ms:number,message:string):Promise<T>{
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),ms)})]);}
  finally{clearTimeout(timer);}
}
const executable=process.env.CORMI_BROWSER_EXECUTABLE??'/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const env={...process.env,CI:'true',NODE_PATH:'',NODE_OPTIONS:''};
const browser=await chromium.launch({executablePath:executable,headless:true});
const report:{app:string;browser:string;stages:Array<Record<string,unknown>>;passed:boolean;restored?:boolean;error?:string}={app,browser:browser.version(),stages:[],passed:false};
let serverCount=0;
async function server(command:'dev'|'preview',run:(url:string)=>Promise<void>) {
  const number=++serverCount,events:Array<Record<string,unknown>>=[];let stdout='',log='',ended=false;
  const child=spawn(process.execPath,[join(app,'node_modules/cormijs/dist/cli.js'),command,'--json','--startup-timeout','60000'],{cwd:app,env,stdio:['ignore','pipe','pipe']});
  const done=new Promise<{code:number|null;signal:NodeJS.Signals|null}>((accept,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{ended=true;accept({code,signal})});});void done.catch(()=>{});
  child.stdout.on('data',data=>{const text=String(data);log+=text;stdout+=text;for(;;){const index=stdout.indexOf('\n');if(index<0)break;const line=stdout.slice(0,index);stdout=stdout.slice(index+1);try{events.push(JSON.parse(line));}catch{}}});
  child.stderr.on('data',data=>{log+=String(data)});
  let url='';
  try{
    const until=Date.now()+65000;
    while(!ended&&Date.now()<until){const ready=events.find(event=>event.type==='ready');if(ready){url=String(ready.url);break;}await delay(30);}
    assert.ok(url,'Server failed to become ready: '+log.slice(-5000));assert.ok(['127.0.0.1','localhost'].includes(new URL(url).hostname));
    await run(url);assert.equal(events.filter(event=>event.type==='starting').length,1,'Fault repair must not restart the worker');
  }finally{
    try{
      if(!ended)child.kill('SIGTERM');
      const exit=await within(done,10000,'CLI cleanup deadline exceeded');assert.deepEqual(exit,{code:0,signal:null});
      if(url){const socket=createServer();await new Promise<void>((accept,reject)=>{socket.once('error',reject);socket.listen(Number(new URL(url).port),'127.0.0.1',()=>socket.close(error=>error?reject(error):accept()))});}
      report.stages.push({stage:'cleanup',command,exit,portRebound:!!url});
    }catch(error){if(!ended){child.kill('SIGKILL');await within(done,3000,'Owned process termination unconfirmed');}throw error;}
    finally{await writeFile(join(out,`server-${number}-${command}.log`),log);}
  }
}
let buildNumber=0;
function build() {
  const text=execFileSync(process.execPath,[join(app,'node_modules/cormijs/dist/cli.js'),'build','--json','--startup-timeout','60000'],{cwd:app,env,encoding:'utf8',maxBuffer:8*1024**2,timeout:75000});
  report.stages.push({stage:'build',ordinal:++buildNumber,log:text});
}
async function page(url:string) {
  const p=await browser.newPage({viewport:{width:1440,height:1000}});p.setDefaultTimeout(15000);p.setDefaultNavigationTimeout(25000);
  await p.route('**/*',async route=>{const target=new URL(route.request().url());if(target.origin===new URL(url).origin||['data:','blob:'].includes(target.protocol))await route.continue();else await route.abort('blockedbyclient');});
  return p;
}
async function working(p:Page,url:string){
  await p.goto(new URL('user',url).href);await p.getByRole('heading',{name:'Users',exact:true}).waitFor();
  assert.equal(await p.locator('#root__layout').count(),1);assert.equal(await p.locator('.error-boundary-root').count(),0);
  await p.getByPlaceholder('Search user...').fill('Adam Trantow');await p.waitForFunction(()=>document.querySelectorAll('tbody th').length===1);
  assert.match(await p.locator('tbody th').innerText(),/Adam Trantow/);
}
async function fault(url:string,label:string,token:string,transport?:string){
  const p=await page(url),messages:string[]=[],errors:string[]=[],failedRequests:string[]=[];let intercepted=0;
  p.on('console',message=>{if(['error','warning'].includes(message.type()))messages.push(message.text())});p.on('pageerror',error=>errors.push(error.message));
  p.on('requestfailed',request=>failedRequests.push(request.url()));
  try{
    if(transport)await p.route(transport,async route=>{intercepted++;await route.abort('failed')});
    await p.goto(new URL('user',url).href);
    await p.getByRole('heading',{name:'Unexpected Application Error!',exact:true}).waitFor();
    const content=await p.locator('.error-boundary-root').innerText();assert.match(content,new RegExp(token));
    assert.equal(await p.getByRole('heading',{name:/Sorry, page not found/}).count(),0);
    assert.equal(await p.locator('#root__layout').count(),0);
    if(transport)assert.ok(intercepted>0);else assert.equal(failedRequests.length,0,JSON.stringify(failedRequests));
    await p.evaluate(()=>document.fonts.ready);await p.screenshot({path:join(out,label+'-error.png')});
    report.stages.push({stage:label,errorView:'original-error-boundary',content,messages,errors,failedRequests,intercepted});
  }finally{await p.close();}
}
async function repaired(url:string,label:string){
  const p=await page(url),errors:string[]=[],badResponses:string[]=[];
  p.on('pageerror',error=>errors.push(error.message));p.on('response',response=>{if(response.status()>=400)badResponses.push(response.url())});
  try{await working(p,url);await p.waitForLoadState('networkidle');assert.equal(errors.length,0);assert.equal(badResponses.length,0,JSON.stringify(badResponses));report.stages.push({stage:label,recovered:true,userSearch:true});}
  finally{await p.close();}
}
try{
  await server('dev',async url=>{
    await repaired(url,'dev-before');
    for(const [kind,source,token] of [
      ['render',"export default function UserPage(){throw Error('CORMI_ADMIN_RENDER_FAILURE');return null}",'CORMI_ADMIN_RENDER_FAILURE'],
      ['evaluation',"throw Error('CORMI_ADMIN_EVALUATION_FAILURE');export default function UserPage(){return null}",'CORMI_ADMIN_EVALUATION_FAILURE'],
    ]){
      await replace(source!);
      const until=Date.now()+7000;let transformed='';while(Date.now()<until){transformed=await (await fetch(new URL('src/pages/user.tsx',url))).text();if(transformed.includes(token!))break;await delay(25);}assert.ok(transformed.includes(token!));
      await fault(url,'dev-'+kind,token!);await replace(original);
      while(Date.now()<until+7000){transformed=await (await fetch(new URL('src/pages/user.tsx',url))).text();if(!transformed.includes(token!))break;await delay(25);}assert.ok(!transformed.includes(token!));
      await repaired(url,'dev-'+kind+'-recovered');
    }
    await fault(url,'dev-transport','Failed to fetch dynamically imported module','**/src/pages/user.tsx*');
    await repaired(url,'dev-transport-recovered');
  });
  for(const [kind,source,token] of [
    ['render',"export default function UserPage(){throw Error('CORMI_ADMIN_RENDER_FAILURE');return null}",'CORMI_ADMIN_RENDER_FAILURE'],
    ['evaluation',"throw Error('CORMI_ADMIN_EVALUATION_FAILURE');export default function UserPage(){return null}",'CORMI_ADMIN_EVALUATION_FAILURE'],
  ]){
    await replace(source!);build();await server('preview',url=>fault(url,'preview-'+kind,token!));await replace(original);
  }
  build();const chunks=(await readdir(join(app,'dist/assets'))).filter(name=>/^user-[^/]+\.js$/.test(name));assert.equal(chunks.length,1);
  await server('preview',async url=>{await fault(url,'preview-transport','Failed to fetch dynamically imported module','**/assets/'+chunks[0]);await repaired(url,'preview-restored');});
  assert.equal(hash(await readFile(boundary)),expected['src/routes/components/error-boundary.tsx'].sha256);
  report.passed=true;
}catch(error){report.error=error instanceof Error?error.stack:String(error);}
finally{
  try{await replace(original);report.restored=hash(await readFile(file))===hash(original);}catch(error){report.passed=false;report.error=(report.error??'')+'\nRESTORE: '+String(error);}
  await browser.close();await writeFile(join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,restored:report.restored,stages:report.stages.length,out,error:report.error}));if(!report.passed)process.exitCode=1;
}
