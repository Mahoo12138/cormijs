import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeEnvironmentFixture, verifyEnvironmentPage, privateMarkers, environmentLiteral } from './environment-fixture.js';
import { writeTypecheckGraph, compilerFootprint } from './typescript-fixture.js';
import { writeAppRuntimeFixture, verifyAppRuntimePage, appRuntimeSource } from './app-runtime-fixture.js';
import { writeConfigRoutesFixture, verifyConfigRoutesPage } from './config-routes-fixture.js';
import { writeConventionsFixture, verifyConventionsPage } from './conventions-fixture.js';
import { writeHistoryFixture, verifyHistoryPage } from './history-fixture.js';
import { writeModelFixture, verifyModelPage } from './model-fixture.js';
import { writeInitialStateFixture, verifyInitialStatePage } from './initial-state-fixture.js';
import { writeRequestFixture, verifyRequestPage } from './request-fixture.js';
import { writeLocaleFixture, verifyLocalePage } from './locale-fixture.js';
import { writeAccessFixture, verifyAccessPage } from './access-fixture.js';
import { writeMenuFixture, verifyMenuPage } from './menu-fixture.js';
import { writeHtmlFixture, verifyHtmlPage } from './html-fixture.js';
import { writeMockFixture, verifyMockPage } from './mock-fixture.js';
import { writeAliasFixture, verifyAliasPage } from './alias-fixture.js';
import { writeDefineFixture, verifyDefinePage } from './define-fixture.js';
import { writeGlobalStyleFixture, verifyGlobalStylePage } from './global-style-fixture.js';
import { writeAccessConventionFixture, verifyAccessConventionPage } from './access-convention-fixture.js';
import { writeLocaleCatalogFixture, verifyLocaleCatalogPage } from './locale-catalog-fixture.js';
import { writeClientLoaderFixture, verifyClientLoaderPage } from './client-loader-fixture.js';
import { writeHeadFixture, verifyHeadPage } from './head-fixture.js';
import { writeSsrFixture, verifySsrPage } from './ssr-fixture.js';
import { writePrefetchFixture, verifyPrefetchPage } from './prefetch-fixture.js';
import { writeOutputFixture, verifyOutputBuild, verifyOutputPage } from './output-fixture.js';
import { writeGeneratorFixture } from './generator-fixture.js';
import { writeStaticExportFixture, verifyStaticExport, verifyStaticExportPages } from './static-export-fixture.js';
import { writeMpaFixture, verifyMpaPages, verifyMpaOutput } from './mpa-fixture.js';
import { writeAntdFixture, verifyAntdPage } from './antd-fixture.js';
import { writeAnalyticsFixture, verifyAnalyticsPage } from './analytics-fixture.js';
import { writeToolsFixture, writeFakeTools } from './tools-fixture.js';
import { writeConventionalLoaderFixture, verifyConventionalLoaderPage } from './conventional-loader-fixture.js';
import { packWorkspace, createReactConsumer, consumerManifest, consumerNpmrc, run, sha256, type LocalKit } from './packaging.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'cormi packed 空格-')));
let delivery = join(temporary, 'kit');
const logRoot = join(root, '.cache', 'package-test-' + Date.now()); await mkdir(logRoot, { recursive: true });
const report: { format: string; startedAt: string; node: string; platform: string; passed: boolean; stages: Array<Record<string, unknown>>; packages?: unknown; blockers?: string[]; retainedConsumer?: string } = {
  format: 'cormi:package-test:1', startedAt: new Date().toISOString(), node: process.version, platform: process.platform + '-' + process.arch, passed: false, stages: [],
};
// Share only the content-addressed download cache; installation copies package files into each consumer.
const env: NodeJS.ProcessEnv = { ...process.env, CI: 'true', NODE_PATH: '', NODE_OPTIONS: '',
  npm_config_store_dir: join(root, '.cache/pnpm-store'), npm_config_cache_dir: join(root, '.cache/pnpm-cache'),
  npm_config_state_dir: join(temporary, 'state'), npm_config_ignore_scripts: 'true', npm_config_package_import_method: 'copy',
  npm_config_userconfig: join(temporary, 'empty.npmrc'), npm_config_globalconfig: join(temporary, 'empty-global.npmrc') };
await writeFile(env.npm_config_userconfig!, ''); await writeFile(env.npm_config_globalconfig!, '');
let kit: LocalKit;
async function execute(label: string, cwd: string, executable: string, args: string[], expected = 0, pattern?: RegExp) {
  const result = await run(executable, args, cwd, env, 60000);
  const text = result.stdout + result.stderr, log = join(logRoot, label + '.log'); await writeFile(log, text);
  assert.equal(result.code, expected, `${label}: expected exit ${expected}\n${text}`);
  if (pattern) assert.match(text, pattern);
  report.stages.push({ label, exitCode: result.code, expectedExitCode: expected, log, sha256: sha256(text) });
  console.log('PASS', label); return result;
}
async function install(label: string, cwd: string, expected = 0, pattern?: RegExp) {
  // A cold cache after cleanup needs one online warm-up: CORMI_PACKAGE_OFFLINE=0.
  return execute(label, cwd, 'pnpm', ['install', ...(process.env.CORMI_PACKAGE_OFFLINE === '0' ? [] : ['--offline']), '--ignore-scripts', '--no-frozen-lockfile'], expected, pattern);
}
async function create(name: string, profile: 'core' | 'launcher' | 'react', patched = true) {
  const path = join(delivery, name); await mkdir(path);
  await writeFile(join(path, 'package.json'), JSON.stringify(consumerManifest(kit, profile, patched), null, 2));
  await writeFile(join(path, '.npmrc'), consumerNpmrc); return path;
}
const typeArguments = ['node_modules/typescript/bin/tsc', '--noEmit', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--skipLibCheck', 'false', 'types.mts'];
async function auditLinks(cwd: string, standalone = false) {
  let links = 0;
  async function visit(directory: string): Promise<void> {
    for (const name of await readdir(directory)) {
      const file = join(directory, name), info = await lstat(file);
      if (info.isSymbolicLink()) { const actual = await realpath(file); assert.ok(actual.startsWith(cwd + sep), `Link escapes consumer: ${file} -> ${actual}`); links++; }
      else if (info.isDirectory()) await visit(file);
    }
  }
  await visit(join(cwd, 'node_modules'));
  if (standalone) assert.equal(await readFile(join(cwd, 'pnpm-workspace.yaml'), 'utf8'), 'packages: []\n');
  else assert.ok(!existsSync(join(cwd, 'pnpm-workspace.yaml')));
  const lock = await readFile(join(cwd, 'pnpm-lock.yaml'), 'utf8');
  assert.doesNotMatch(lock, /workspace:|link:.*packages\//);
  const lockFile = join(logRoot, cwd.split(sep).at(-1) + '-pnpm-lock.yaml'); await writeFile(lockFile, lock);
  report.stages.push({ label: 'isolated-links:' + cwd.split(sep).at(-1), links, workspaceLinks: 0, lockFile, lockSha256: sha256(lock) });
}
async function cordisRuntimeHash(cwd: string) {
  const fromCore = createRequire(join(await realpath(join(cwd, 'node_modules/@cormijs/core')), 'package.json'));
  return sha256(await readFile(fromCore.resolve('cordis')));
}
const coreSmoke = `import assert from 'node:assert/strict'; import {createRequire} from 'node:module'; import {pathToFileURL} from 'node:url';
import {ProjectRuntime, Context} from '@cormijs/core';
const require=createRequire(import.meta.url); assert.throws(()=>require.resolve('vite'),{code:'MODULE_NOT_FOUND'}); assert.throws(()=>require.resolve('react'),{code:'MODULE_NOT_FOUND'});
const cordis=await import(pathToFileURL(createRequire(import.meta.resolve('@cormijs/core')).resolve('cordis')).href); assert.equal(Context,cordis.Context);
const h=new ProjectRuntime();h.mount('consumer',{inject:['value'],apply(ctx){assert.equal(ctx.get('value'),42)}});h.mount('provider',ctx=>ctx.provide('value',42));await h.ready();await h.dispose();console.log('PACKED_CORE_OK');`;
const coreTypes = `import {ProjectRuntime,type Context} from '@cormijs/core';const h=new ProjectRuntime();const ctx:Context=h.ctx;ctx.provide('value',42);await h.ready();await h.dispose();\n// @ts-expect-error the public API must not degrade to any\nconst invalid:string=h;\n`;
async function command(label: string, cwd: string, name: string, expected = 0, pattern?: RegExp) {
  return execute(label, cwd, join(cwd, 'node_modules/.bin/cormi'), [name, '--json', '--startup-timeout', '30000'], expected, pattern);
}
async function withServer(cwd: string, name: 'dev' | 'preview' | 'serve', action: (url: string) => Promise<void>, args: string[] = [], carrierFile?: string) {
  const sessionLabel = cwd.split(sep).at(-1) + '-' + name + (carrierFile ? '-bootstrap' : '');
  const executable = carrierFile ? process.execPath : join(cwd, 'node_modules/.bin/cormi');
  const argv = carrierFile ? [carrierFile,name] : [name, '--json', '--startup-timeout', '30000', ...args];
  const child = spawn(executable, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const events: Array<Record<string, any>> = []; let stdout = '', stderr = '', buffer = '';
  let resolveReady!: (url: string) => void, rejectReady!: (error: Error) => void;
  const ready = new Promise<string>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const done = new Promise<number | null>((resolve, reject) => {
    child.once('error', error => { rejectReady(error); reject(error); });
    child.once('close', code => { rejectReady(new Error(`Server exited before ready: ${code}\n${stderr}`)); resolve(code); });
  });
  // The completion promise is awaited during cleanup, but launch failures can occur earlier.
  void done.catch(() => {});
  child.stdout.on('data', chunk => {
    stdout += String(chunk); buffer += String(chunk);
    for (;;) {
      const at = buffer.indexOf('\n'); if (at < 0) break;
      const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
      try { const event = JSON.parse(line); events.push(event); if (event.type === 'ready') resolveReady(event.url); if (event.type === 'error') rejectReady(new Error(JSON.stringify(event))); } catch (error) { if (!(error instanceof SyntaxError)) rejectReady(error as Error); }
    }
  });
  child.stderr.on('data', chunk => { stderr += String(chunk); });
  const startupTimer = setTimeout(() => rejectReady(new Error('Packed server readiness timeout')), 35000);
  try { const url = await ready; clearTimeout(startupTimer); await action(url); }
  finally {
    clearTimeout(startupTimer);
    if (child.exitCode === null) child.kill('SIGTERM');
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      const code = await Promise.race([done, new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Packed server cleanup deadline exceeded')), 8000); })]);
      assert.equal(code, 0, JSON.stringify(events) + stderr);
      assert.equal(existsSync(join(cwd, '.cormi.lock')), false, 'Packed CLI must release its lock');
      report.stages.push({ label: sessionLabel + '-session', exitCode: code, workerStarts: events.filter(x => x.type === 'starting').length });
    } catch (error) { child.kill('SIGKILL'); report.retainedConsumer = temporary; throw error; }
    finally { clearTimeout(deadline); await writeFile(join(logRoot, sessionLabel + '-server.log'), stdout + stderr); }
  }
}
try {
  // Subset runs keep the suite usable on small disks: CORMI_PACKAGE_ONLY=analytics,locale
  const packageOnly = (process.env.CORMI_PACKAGE_ONLY ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const selected = (name: string) => !packageOnly.length || packageOnly.includes(name);
  kit = await packWorkspace(root, delivery); report.packages = kit.packages; report.blockers = kit.blockers;
  report.stages.push({ label: 'archive-exports-imports-maps-bins', packages: kit.packages.length });
  console.log('PASS packed archives', kit.packages.length);
  const raw = await create('raw', 'core', false); await install('raw-install', raw);
  await writeFile(join(raw, 'smoke.mjs'), coreSmoke); await execute('raw-runtime', raw, process.execPath, ['smoke.mjs'], 0, /PACKED_CORE_OK/);
  await writeFile(join(raw, 'types.mts'), coreTypes);
  await execute('raw-nodenext-expected-failure', raw, process.execPath, typeArguments, 2, /cordis[\s\S]*TS283[45]/);
  const rawHash = await cordisRuntimeHash(raw); await auditLinks(raw);
  const core = await create('core', 'core'); await install('core-install', core);
  await writeFile(join(core, 'smoke.mjs'), coreSmoke); await writeFile(join(core, 'types.mts'), coreTypes);
  await execute('core-runtime', core, process.execPath, ['smoke.mjs'], 0, /PACKED_CORE_OK/);
  await execute('core-strict-types', core, process.execPath, typeArguments);
  assert.equal(await cordisRuntimeHash(core), rawHash, 'Declaration patch must not modify upstream JavaScript'); await auditLinks(core);
  report.stages.push({ label: 'cordis-runtime-identity', sha256: rawHash, unchanged: true });
  const service = await create('dev-api-service', 'core');
  const serviceManifest = consumerManifest(kit, 'core');
  serviceManifest.dependencies['@cormijs/plugin-dev-api'] = serviceManifest.pnpm.overrides['@cormijs/plugin-dev-api']!;
  await writeFile(join(service, 'package.json'), JSON.stringify(serviceManifest));
  await install('dev-api-service-install', service);
  await writeFile(join(service, 'types.mts'), `import {ProjectRuntime} from '@cormijs/core';import {DevApiService} from '@cormijs/plugin-dev-api/service';
const h=new ProjectRuntime();h.mount('api',DevApiService);h.mount('consumer',{inject:['devApi'],apply(ctx){ctx.devApi.add('mine',{mocks:[{method:'GET',path:'/ok',handle:()=>({body:true})}]});
// @ts-expect-error public rules may not become any
ctx.devApi.add('invalid',{mocks:[{method:'GET',path:'/bad',handle:123}]});}});await h.dispose();`);
  await execute('dev-api-service-strict-types', service, process.execPath, typeArguments);
  await writeFile(join(service, 'service.mjs'), `import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {ProjectRuntime} from '@cormijs/core';import {DevApiService} from '@cormijs/plugin-dev-api/service';
const require=createRequire(import.meta.url);for(const name of ['vite','react','@cormijs/plugin-vite'])assert.throws(()=>require.resolve(name),{code:'MODULE_NOT_FOUND'});
const h=new ProjectRuntime();h.mount('api',DevApiService);h.mount('feature',{inject:['devApi'],apply(ctx){ctx.devApi.add('feature',{mocks:[{method:'GET',path:'/ok',handle:()=>({body:true})}]})}});await h.ready();assert.equal(h.ctx.devApi.summary().contributions.length,1);await h.unmount('feature');assert.equal(h.ctx.devApi.summary().contributions.length,0);await h.dispose();console.log('PACKED_SERVICE_NO_VITE_OK');`);
  await execute('dev-api-service-no-vite-runtime', service, process.execPath, ['service.mjs'], 0, /PACKED_SERVICE_NO_VITE_OK/);
  await auditLinks(service);
  const launcher = await create('launcher', 'launcher'); await install('launcher-install', launcher);
  await execute('launcher-bin', launcher, join(launcher, 'node_modules/.bin/cormi'), ['--help'], 0, /cormi <command>/);
  await writeFile(join(launcher, 'types.mts'), `import {defineConfig,type Diagnosis} from 'cormijs';import {runCormi} from 'cormijs/launcher';void runCormi;defineConfig({plugins:[]});declare const result:Diagnosis;const health:boolean=result.healthy;void health;\n// @ts-expect-error metadata is not any\nconst invalid:number=result.graph.nodes[0]!.state;`);
  await writeFile(join(launcher, 'bootstrap-types.mts'), `import {createBootstrap,type LaunchPolicy,type LaunchEnvironment,type LaunchReload,readEnvironmentFiles,fingerprintFiles} from 'cormijs/bootstrap';import {runCormi} from 'cormijs/launcher';
const bootstrap=createBootstrap({environment:{apply(ctx){ctx.provide('launchEnvironment',{files:()=>[],load:({root,plan,files})=>readEnvironmentFiles(root,plan.mode,files)} satisfies LaunchEnvironment);}}});
void runCormi({root:'.',command:'probe',bootstrap});declare const policy:LaunchPolicy;declare const reload:LaunchReload;
// @ts-expect-error node environment is not arbitrary or any
const invalid:'arbitrary'=policy.resolve({command:'probe'}).nodeEnv;
const stamp:Promise<string>=fingerprintFiles([]);void stamp;
// @ts-expect-error a wake-up request requires cancellation and file inputs
reload.wait({intervalMs:200});`);
  await execute('bootstrap-public-types',launcher,process.execPath,[...typeArguments.slice(0,-1),'bootstrap-types.mts']);
  await writeFile(join(launcher,'worker-types.mts'),`import {defineConfig} from 'cormijs';import {createWorkerProfile,type WorkerExecution} from 'cormijs/worker';import {runCormiCli} from 'cormijs/cli';
const worker=createWorkerProfile({execution:{apply(ctx){ctx.provide('workerExecution',{async run({application,command,report}){const result=await application.initialize();report({type:'execution-report',name:'check',data:{command,ok:result.ok}});return {kind:'result',data:result.ok};}} satisfies WorkerExecution);}}});defineConfig({worker});void runCormiCli;
declare const execution:WorkerExecution;
// @ts-expect-error runtime execution needs its full request and application context
execution.run({command:'check'});
// @ts-expect-error worker must remain a native plugin, not arbitrary JSON
const invalid=defineConfig({worker:'builtin'});`);
  await execute('worker-profile-public-types',launcher,process.execPath,[...typeArguments.slice(0,-1),'worker-types.mts']);
  await execute('launcher-types', launcher, process.execPath, typeArguments);
  await writeFile(join(launcher, 'cormi.config.ts'), `import {defineConfig} from 'cormijs';export default defineConfig({plugins:[{id:'echo',plugin:{inject:['commands'],apply(ctx){ctx.effect(()=>ctx.commands.register('echo',async()=>({kind:'result',data:'PACKED_COMMAND_OK'})))}}}]});`);
  await command('launcher-custom-command', launcher, 'echo', 0, /PACKED_COMMAND_OK/);
  await execute('packed-starting-cancellation', launcher, process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '-e',
    `import assert from 'node:assert/strict';import {runCormi} from 'cormijs/launcher';
const controller=new AbortController();const code=await runCormi({root:process.cwd(),command:'echo',signal:controller.signal,
onEvent(event){if(event.type==='starting')controller.abort();}});assert.equal(code,0);console.log('PACKED_START_CANCEL_OK');`], 0, /PACKED_START_CANCEL_OK/);
  await execute('packed-diagnose-no-web', launcher, join(launcher, 'node_modules/.bin/cormi'), ['diagnose', '--for', 'echo', '--json'], 0, /cormi:diagnosis:1/);
  const normalLauncherConfig = await readFile(join(launcher, 'cormi.config.ts'), 'utf8');
  await writeFile(join(launcher,'cormi.config.ts'),`export default ({command,mode,env})=>({plugins:[{id:'echo',plugin:{inject:['commands'],apply(ctx){ctx.effect(()=>ctx.commands.register('echo',async()=>({kind:'result',data:{command,mode,node:env.NODE_ENV,value:env.CORMI_PUBLIC_BOOT}})))}}}]});`);
  await writeFile(join(launcher,'company.json'),JSON.stringify({title:'installed-custom-provider'}));
  await writeFile(join(launcher,'.env'),'MUST_NOT_READ="broken');
  await execute('packed-bootstrap-no-web',launcher,process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';import {join} from 'node:path';import {readFile} from 'node:fs/promises';import {runCormi} from 'cormijs/launcher';import {createBootstrap,fingerprintFiles} from 'cormijs/bootstrap';
let closed=0;const policy={apply(ctx){ctx.provide('launchPolicy',{resolve:()=>({configurationCommand:'echo',mode:'staging',nodeEnv:'development',watch:false})});}};
const environment={apply(ctx){ctx.effect(()=>()=>{closed++;});ctx.provide('launchEnvironment',{files:root=>[join(root,'company.json')],async load({plan,files,signal}){
 signal.throwIfAborted();const fingerprint=await fingerprintFiles(files);const text=await readFile(files[0],'utf8');assert.ok(Buffer.byteLength(text)<4096);const input=JSON.parse(text);assert.equal(typeof input.title,'string');signal.throwIfAborted();
 return {mode:plan.mode,paths:files,fingerprint,files:[{name:'company.json',present:true}],values:{CORMI_PUBLIC_BOOT:input.title},origins:{CORMI_PUBLIC_BOOT:['company.json']}};
}});}};
let result;const code=await runCormi({root:process.cwd(),command:'echo',bootstrap:createBootstrap({policy,environment}),onEvent:e=>{if(e.type==='result')result=e.data;}});
assert.equal(code,0);assert.equal(closed,1);assert.deepEqual(result,{command:'echo',mode:'staging',node:'development',value:'installed-custom-provider'});console.log('PACKED_BOOTSTRAP_OK');`],0,/PACKED_BOOTSTRAP_OK/);
  await rm(join(launcher,'.env'));await rm(join(launcher,'company.json'));await writeFile(join(launcher,'cormi.config.ts'),normalLauncherConfig);

  await writeFile(join(launcher, 'cormi.config.ts'), `export default {plugins:[{id:'missing-feature',plugin:{inject:['missing'],apply(){throw Error('must not activate')}}}]};`);
  await execute('packed-diagnose-missing', launcher, join(launcher, 'node_modules/.bin/cormi'), ['diagnose', '--json'], 1, /DIAGNOSIS_UNHEALTHY/);
  await writeFile(join(launcher, 'cormi.config.ts'), normalLauncherConfig);
  await writeFile(join(launcher,'cormi.config.ts'),`import {createWorkerProfile,diagnosticExecutionPlugin} from 'cormijs/worker';export default {worker:createWorkerProfile({execution:diagnosticExecutionPlugin}),plugins:[{id:'missing',plugin:{inject:['absent'],apply(){throw Error('NEVER_RUN')}}}]};`);
  await execute('packed-worker-audit-failure',launcher,join(launcher,'node_modules/.bin/cormi'),['audit','--json'],1,/DIAGNOSIS_UNHEALTHY/);
  await writeFile(join(launcher,'cormi.config.ts'),`import {createWorkerProfile,commandExecutionPlugin} from 'cormijs/worker';export default {worker:createWorkerProfile({execution:commandExecutionPlugin,diagnostics:false}),plugins:[{id:'diagnose-command',plugin:{inject:['commands'],apply(ctx){if(ctx.get('diagnostics'))throw Error('UNEXPECTED_DIAGNOSTICS');ctx.effect(()=>ctx.commands.register('diagnose',async()=>({kind:'result',data:'PACKED_BUSINESS_DIAGNOSE'})));}}}]};`);
  await execute('packed-worker-business-diagnose',launcher,join(launcher,'node_modules/.bin/cormi'),['diagnose','--json'],0,/PACKED_BUSINESS_DIAGNOSE/);
  await writeFile(join(launcher,'cormi.config.ts'),`export default {worker:{apply(ctx){ctx.provide('workerExecution',{async run({command,report}){report({type:'execution-report',name:'example:worker',data:{command}});return {kind:'result',data:'PACKED_WORKER_PROFILE'};}});}}};`);
  await execute('packed-worker-cli-carrier',launcher,process.execPath,['--input-type=module','-e',`import assert from 'node:assert/strict';import {runCormiCli} from 'cormijs/cli';let out='';const listeners=process.listenerCount('SIGTERM');const code=await runCormiCli(['probe','--json'],{stdout:text=>{out+=text}});assert.equal(code,0);const events=out.trim().split('\\n').map(line=>JSON.parse(line));assert.equal(events.find(e=>e.type==='execution-report').name,'example:worker');assert.equal(events.find(e=>e.type==='result').data,'PACKED_WORKER_PROFILE');assert.equal(process.listenerCount('SIGTERM'),listeners);console.log('PACKED_CLI_CARRIER_OK');`],0,/PACKED_CLI_CARRIER_OK/);
  await writeFile(join(launcher,'cormi.config.ts'),normalLauncherConfig);
  await execute('launcher-no-vite', launcher, process.execPath, ['--input-type=module', '-e', `import {createRequire} from 'node:module';import assert from 'node:assert/strict';const r=createRequire(import.meta.url);assert.throws(()=>r.resolve('vite'),{code:'MODULE_NOT_FOUND'});assert.throws(()=>r.resolve('@cormijs/core/dist/index.js'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});`]);
  await auditLinks(launcher);
  const typeOnly = await create('typechecking', 'core'), typeManifest = consumerManifest(kit, 'core');
  typeManifest.dependencies['@cormijs/plugin-typescript'] = typeManifest.pnpm.overrides['@cormijs/plugin-typescript']!;
  await writeFile(join(typeOnly, 'package.json'), JSON.stringify(typeManifest));
  await install('typechecking-no-web-install', typeOnly); await writeTypecheckGraph(typeOnly, false);
  const typeBefore = await compilerFootprint(typeOnly);
  await execute('typechecking-no-vite-native-provider', typeOnly, process.execPath, ['--input-type=module','-e',
    `import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {ProjectRuntime} from '@cormijs/core';import {typescriptServicePlugin} from '@cormijs/plugin-typescript';
const r=createRequire(import.meta.url);assert.throws(()=>r.resolve('vite'),{code:'MODULE_NOT_FOUND'});assert.throws(()=>r.resolve('react'),{code:'MODULE_NOT_FOUND'});
const host=new ProjectRuntime();host.mount('compiler',typescriptServicePlugin);try{await host.ready();const result=await host.ctx.typechecker.check(process.cwd(),[],new AbortController().signal);assert.equal(result.mode,'solution');assert.equal(result.projects.length,4);assert.equal(result.virtualDeclarations,1);console.log('PACKED_TS_SOLUTION_OK');}finally{await host.dispose();}`],0,/PACKED_TS_SOLUTION_OK/);
  assert.deepEqual(await compilerFootprint(typeOnly), typeBefore); await auditLinks(typeOnly);
  const missing = await create('missing-peer', 'react');
  const missingManifest = consumerManifest(kit, 'react'); delete missingManifest.dependencies['react-dom'];
  await writeFile(join(missing, 'package.json'), JSON.stringify(missingManifest));
  await install('missing-peer-rejected', missing, 1, /ERR_PNPM_PEER_DEP_ISSUES/);
  const sdk = await create('sdk', 'react'); const sdkManifest = consumerManifest(kit, 'react');
  Object.assign(sdkManifest.dependencies, sdkManifest.pnpm.overrides); await writeFile(join(sdk, 'package.json'), JSON.stringify(sdkManifest));
  await install('sdk-install', sdk);
  const specifiers = kit.packages.map(item => item.name).concat('cormijs/launcher', 'cormijs/bootstrap', 'cormijs/worker', 'cormijs/cli', '@cormijs/builder/development', '@cormijs/plugin-dev-api/vite', '@cormijs/plugin-dev-api/service');
  await writeFile(join(sdk, 'types.mts'), specifiers.map((specifier, i) => `import * as p${i} from ${JSON.stringify(specifier)};void p${i};`).join('\n'));
  await execute('all-public-types', sdk, process.execPath, typeArguments);
  await writeFile(join(sdk,'typescript-types.mts'),`import {checkTypes,typescriptPlugin,type TypeChecker,type TypecheckOptions} from '@cormijs/plugin-typescript';import {defineConfig} from 'cormijs';
const options:TypecheckOptions={generatedProject:'tsconfig.app.json'};defineConfig({plugins:[{id:'types',plugin:typescriptPlugin,options}]});declare const checker:TypeChecker;
const result=await checker.check('.',[],new AbortController().signal,options);const mode:'single'|'solution'=result.mode;void mode;void checkTypes;
// @ts-expect-error project selection is not an arbitrary numeric selector
const invalid:TypecheckOptions={generatedProject:1};
// @ts-expect-error a check cannot omit its cancellation signal
checker.check('.',[]);`);
  await execute('typechecking-public-strict-types',sdk,process.execPath,[...typeArguments.slice(0,-1),'typescript-types.mts']);
  await writeFile(join(sdk, 'exports.mjs'), `for(const name of ${JSON.stringify(specifiers)}){await import(name); console.log(name)}`);
  await execute('all-public-esm-exports', sdk, process.execPath, ['exports.mjs']); await auditLinks(sdk);
  const initialApp = join(delivery, 'app'); await createReactConsumer(root, kit, initialApp);
  await install('react-install', initialApp); await auditLinks(initialApp);
  const originalDelivery = delivery, originalLock = await readFile(join(initialApp, 'pnpm-lock.yaml'));
  delivery = join(temporary, 'relocated kit 中文'); await rename(originalDelivery, delivery);
  const app = join(delivery, 'app');
  // Remove only this test's installation. The old location no longer exists, so resolution cannot fall back to it.
  await rm(join(app, 'node_modules'), { recursive: true });
  assert.equal(existsSync(originalDelivery), false); assert.equal(existsSync(join(app, 'node_modules')), false);
  for (const item of kit.packages) assert.equal(sha256(await readFile(join(delivery, item.file))), item.sha256);
  assert.equal(sha256(await readFile(join(delivery, kit.compatibility.patch))), kit.compatibility.sha256);
  await execute('relocated-frozen-reinstall', app, 'pnpm', ['install', ...(process.env.CORMI_PACKAGE_OFFLINE === '0' ? [] : ['--offline']), '--ignore-scripts', '--frozen-lockfile']);
  assert.equal(sha256(await readFile(join(app, 'pnpm-lock.yaml'))), sha256(originalLock), 'Relocation must not rewrite the resolved dependency graph');
  await auditLinks(app);
  report.stages.push({ label: 'relocated-clean-install', oldLocationExists: false, reusedNodeModules: false, lockUnchanged: true });
  await command('react-prepare', app, 'prepare'); await command('react-typecheck', app, 'typecheck'); await command('react-inspect', app, 'inspect', 0, /last-successful-generation/);
  const generatedBeforeConfig = await readFile(join(app, '.cormi/inspect.jsonc'));
  await execute('packed-config-build-provenance', app, join(app, 'node_modules/.bin/cormi'), ['config', '--for', 'build', '--json'], 0, /current-config-evaluation/);
  assert.equal(sha256(await readFile(join(app, '.cormi/inspect.jsonc'))), sha256(generatedBeforeConfig));
  await execute('packed-diagnose-react', app, join(app, 'node_modules/.bin/cormi'), ['diagnose', '--for', 'dev', '--json'], 0, /react-hooks/);
  assert.equal(sha256(await readFile(join(app, '.cormi/inspect.jsonc'))), sha256(generatedBeforeConfig));
  const executablePath = process.env.CORMI_BROWSER_EXECUTABLE ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  assert.ok(existsSync(executablePath), 'Set CORMI_BROWSER_EXECUTABLE to an installed Chromium executable; browser checks are required');
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(12000); const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await withServer(app, 'dev', async url => {
      await page.goto(url); assert.match(await page.title(), /cormi/);
      await page.locator('#root h1').filter({hasText:'cormi is running.'}).waitFor();
      await page.locator('#root button').click(); await page.locator('#root button').click();
      const home = join(app, 'src/pages/index.tsx'); await writeFile(home, (await readFile(home, 'utf8')).replace('cormi is running.', 'Packed consumer updated.'));
      await page.locator('#root h1').filter({hasText:'Packed consumer updated.'}).waitFor();
      assert.match(await page.locator('#root button').innerText(), /Count: 2/);
      await writeFile(join(app, 'src/pages/about.jsx'), 'export default ()=>null');
      await page.locator('cormi-development-overlay [role=alert]').waitFor();
      await unlink(join(app, 'src/pages/about.jsx'));
      await page.locator('cormi-development-overlay').waitFor({state:'detached'}); assert.match(await page.locator('#root button').innerText(), /Count: 2/);
      await page.goto(new URL('users/73', url).href); await page.locator('#root h1').filter({hasText:'User 73'}).waitFor();
      assert.deepEqual(errors, []);
      await page.screenshot({path:join(logRoot,'packed-consumer.png')});
      report.stages.push({ label:'packed-react-dom-fast-refresh-recovery-deep-route', browser:browser.version(), pageerrors:errors.length });
    });
    await command('react-build', app, 'build'); await command('react-rebuild', app, 'build', 0, /"replaced":true/);
    const marker = await readFile(join(app, 'dist/.cormi-build.json'), 'utf8');
    const about = join(app, 'src/pages/about.tsx'), before = await readFile(about, 'utf8'); await writeFile(about, 'export default ( broken');
    await command('failed-build', app, 'build', 1); assert.equal(await readFile(join(app, 'dist/.cormi-build.json'), 'utf8'), marker);
    await writeFile(about, before); await writeFile(join(app, 'src/type-error.ts'), 'export const value: number = "not a number";');
    await command('failed-types', app, 'typecheck', 1, /TYPECHECK_FAILED/); await unlink(join(app, 'src/type-error.ts'));
    await withServer(app, 'preview', async url => {
      await page.goto(new URL('users/73', url).href); await page.locator('#root h1').filter({hasText:'User 73'}).waitFor();
      assert.equal(await page.locator('cormi-development-overlay').count(), 0); assert.deepEqual(errors, []);
    });
    const features = join(delivery, 'features'); await createReactConsumer(root, kit, features, 'features');
    await install('features-install', features); await auditLinks(features);
    await command('features-typecheck', features, 'typecheck');
    await command('features-inspect', features, 'inspect', 0, /example:status/);
    await withServer(features, 'dev', async url => {
      await page.goto(new URL('status', url).href);
      await page.getByRole('heading', {name:'插件已经接入。', exact:true}).waitFor();
      assert.equal(await page.locator('[data-status-provider]').count(), 1);
      assert.equal(await page.locator('[data-testid="breadcrumbs"]').innerText(), '工作台 / 功能插件');
      await page.getByRole('button', {name:'Count: 0', exact:true}).click();
      assert.equal(await page.getByRole('button', {name:'Count: 1', exact:true}).count(), 1);
      assert.deepEqual(errors, []);
      report.stages.push({label:'packed-feature-page-provider-meta', browser:browser.version(), pageerrors:errors.length});
    });
    await command('features-build', features, 'build');
    await withServer(features, 'preview', async url => {
      await page.goto(new URL('status', url).href);
      await page.getByRole('heading', {name:'插件已经接入。', exact:true}).waitFor();
      assert.equal(await page.locator('[data-testid="feature-label"]').innerText(), '本地工作台');
      assert.deepEqual(errors, []);
    });
    const createdInitial = join(temporary, 'created app 初始');
    const creator = join(delivery, 'sdk/node_modules/.bin/create-cormi');
    await execute('packed-creator-help', temporary, creator, ['--help'], 0, /create-cormi/);
    await execute('packed-create-react-api', temporary, creator, [createdInitial, '--kit', delivery, '--template', 'react-api', '--name', 'created-api', '--json']);
    assert.equal(existsSync(join(createdInitial, 'node_modules')), false);
    assert.equal(existsSync(join(createdInitial, '.git')), false);
    const created = join(temporary, 'created app 移动'); await rename(createdInitial, created);
    await execute('packed-create-refuses-existing', temporary, creator, [created, '--kit', delivery, '--json'], 1, /CREATE_TARGET_EXISTS/);
    // Move the original kit away: generated references must use their own .cormi-local files.
    const movedKit = join(temporary, 'old kit relocated again'); await rename(delivery, movedKit);
    assert.equal(existsSync(delivery), false); delivery = movedKit;
    await install('created-app-install', created); await auditLinks(created, true);
    const createdConfig = join(created, 'cormi.config.ts');
    await writeFile(createdConfig, (await readFile(createdConfig, 'utf8')).replace('port: 8000', 'port: 0'));
    await command('created-app-typecheck', created, 'typecheck');
    await command('created-app-inspect', created, 'inspect');
    await withServer(created, 'dev', async url => {
      await page.goto(url); assert.equal(await page.title(), 'cormi app');
      await page.getByRole('heading', {name:'开始构建你的应用。', exact:true}).waitFor();
      await page.getByRole('button', {name:'请求 Mock', exact:true}).click();
      await page.locator('output').filter({hasText:'Hello, cormi!'}).waitFor();
      await page.getByRole('button', {name:'Count: 0', exact:true}).click();
      await page.getByRole('button', {name:'Count: 1', exact:true}).waitFor();
      assert.equal((await fetch(new URL('/mock.ts?raw',url))).status,403);
      assert.equal((await fetch(new URL('/.cormi-local/manifest.json?raw',url))).status,403);
      assert.equal(await page.locator('cormi-development-overlay,vite-error-overlay').count(),0);
      assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'created-api-app.png')});
      report.stages.push({label:'created-app-browser-mock-and-private-inputs',browser:browser.version(),pageerrors:errors.length});
    });
    await command('created-app-build',created,'build');
    await command('created-app-rebuild',created,'build',0,/"replaced":true/);
    await withServer(created,'preview',async url=>{
      await page.goto(url);await page.getByRole('heading',{name:'开始构建你的应用。',exact:true}).waitFor();
      const response=await fetch(new URL('/api/hello',url));assert.doesNotMatch(await response.text(),/"message":"Hello/);
      assert.deepEqual(errors,[]);
    });
    if (selected('environment')) {
    const environmentConsumer=await create('environment','react');await writeEnvironmentFixture(environmentConsumer);
    await install('environment-install',environmentConsumer);await auditLinks(environmentConsumer);
    const environmentBin=join(environmentConsumer,'node_modules/.bin/cormi');
    for(const name of ['typecheck','config'])await execute('environment-'+name,environmentConsumer,environmentBin,[name,'--mode','staging','--json','--startup-timeout','30000',...(name==='config'?['--for','build']:[])]);
    await withServer(environmentConsumer,'dev',async url=>{await verifyEnvironmentPage(page,url,'selected',false);assert.deepEqual(errors,[]);},['--mode','staging']);
    await execute('environment-build',environmentConsumer,environmentBin,['build','--mode','staging','--json','--startup-timeout','30000']);
    for(const name of await readdir(join(environmentConsumer,'dist/assets')))for(const marker of privateMarkers)assert.equal((await readFile(join(environmentConsumer,'dist/assets',name))).includes(Buffer.from(marker)),false);
    const generatedEnvironment=await readFile(join(environmentConsumer,'.cormi/app.tsx'));
    await writeFile(join(environmentConsumer,'.env.staging.local'),'CORMI_PUBLIC_VALUE=after-build');
    await withServer(environmentConsumer,'preview',async url=>{await verifyEnvironmentPage(page,url,'selected',true);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'environment-preview.png')});},['--mode','staging']);
    assert.deepEqual(await readFile(join(environmentConsumer,'.cormi/app.tsx')),generatedEnvironment);
    report.stages.push({label:'installed-environment-mode-node-client-html-production',privateMarkersAbsent:true,previewRegenerated:false});
    const defaultEnv=await readFile(join(environmentConsumer,'.env'));
    const customFile=join(environmentConsumer,'company.vars'),carrierFile=join(environmentConsumer,'bootstrap-carrier.mjs');
    await writeFile(customFile,`CORMI_PUBLIC_VALUE=custom-bootstrap\nCORMI_PUBLIC_LITERAL=${environmentLiteral}\nCORMI_PRIVATE_VALUE=${privateMarkers[0]}\n`);
    await writeFile(join(environmentConsumer,'.env'),'UNSELECTED_DEFAULT="broken');
    await writeFile(carrierFile,`import {join} from 'node:path';import {runCormiCli} from 'cormijs/cli';import {createBootstrap,readEnvironmentFiles} from 'cormijs/bootstrap';
const environment={apply(ctx){ctx.provide('launchEnvironment',{files:root=>[join(root,'company.vars')],load:({root,plan,files})=>readEnvironmentFiles(root,plan.mode,files)});}};
process.exitCode=await runCormiCli([...process.argv.slice(2),'--mode','staging','--startup-timeout','30000','--json'],{bootstrap:createBootstrap({environment})});`);
    const configFile=join(environmentConsumer,'cormi.config.ts'),originalConfig=await readFile(configFile,'utf8');
    assert.ok(originalConfig.includes('return {presets:[preset]'));
    await writeFile(configFile,`import {createWorkerProfile} from 'cormijs/worker';
const measuredExecution={name:'fixture:worker-execution',inject:['commands'],apply(ctx){ctx.provide('workerExecution',{async run({application,command,request,report}){const readiness=await application.initialize();if(!readiness.ok)throw readiness.error;report({type:'execution-report',name:'fixture:worker',data:{command,ready:true}});return ctx.commands.execute(command,request);}});}};
`+originalConfig.replace('return {presets:[preset]','return {worker:createWorkerProfile({execution:measuredExecution}),presets:[preset]'));
    try {
      await withServer(environmentConsumer,'dev',async url=>{await verifyEnvironmentPage(page,url,'custom-bootstrap',false);assert.equal((await fetch(new URL('company.vars?raw',url))).status,403);assert.deepEqual(errors,[]);},[],carrierFile);
      await execute('bootstrap-environment-build',environmentConsumer,process.execPath,[carrierFile,'build']);
      for(const name of await readdir(join(environmentConsumer,'dist/assets')))for(const marker of privateMarkers)assert.equal((await readFile(join(environmentConsumer,'dist/assets',name))).includes(Buffer.from(marker)),false);
      const generated=await readFile(join(environmentConsumer,'.cormi/app.tsx'));
      await writeFile(customFile,`CORMI_PUBLIC_VALUE=after-custom-build\nCORMI_PUBLIC_LITERAL=${environmentLiteral}\n`);
      await withServer(environmentConsumer,'preview',async url=>{await verifyEnvironmentPage(page,url,'custom-bootstrap',true);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'bootstrap-environment-preview.png')});},[],carrierFile);
      assert.deepEqual(await readFile(join(environmentConsumer,'.cormi/app.tsx')),generated);
      report.stages.push({label:'installed-custom-bootstrap-node-html-client-static',unusedBrokenDotenvIgnored:true,privateInputDenied:true});
      const devLog=await readFile(join(logRoot,'environment-dev-bootstrap-server.log'),'utf8'),previewLog=await readFile(join(logRoot,'environment-preview-bootstrap-server.log'),'utf8');
      for(const log of [devLog,previewLog])assert.match(log,/"type":"execution-report","data":\{"command":"(?:dev|preview)","ready":true\}/);
      report.stages.push({label:'installed-native-worker-execution-with-cli-carrier',development:true,build:true,preview:true});
    }finally{await writeFile(configFile,originalConfig);await writeFile(join(environmentConsumer,'.env'),defaultEnv);await rm(customFile);await rm(carrierFile);}

    }
    if (selected('solution')) {
    const solutionConsumer=await create('solution','react');await writeEnvironmentFixture(solutionConsumer,'/solution/');await writeTypecheckGraph(solutionConsumer,true);
    await install('solution-install',solutionConsumer);await auditLinks(solutionConsumer);
    const solutionBin=join(solutionConsumer,'node_modules/.bin/cormi');
    async function solutionCheck(label:string,expected=0,pattern?:RegExp){
      const before=await compilerFootprint(solutionConsumer);
      const result=await execute(label,solutionConsumer,solutionBin,['typecheck','--json','--mode','staging','--startup-timeout','30000'],expected,pattern);
      assert.deepEqual(await compilerFootprint(solutionConsumer),before);assert.equal(existsSync(join(solutionConsumer,'.cormi.lock')),false);return result;
    }
    const initialCheck=await solutionCheck('solution-typecheck-clean',0,/"mode":"solution"/);
    const summary=initialCheck.stdout.split('\n').flatMap(line=>{try{return [JSON.parse(line)]}catch{return []}}).find(event=>event.type==='result')?.data;
    assert.equal(summary.projects.length,4);assert.equal(summary.virtualDeclarations,1);
    assert.deepEqual(summary.projects.filter((project:{generated:boolean})=>project.generated).map((project:{config:string})=>project.config),['tsconfig.app.json']);
    const shared=join(solutionConsumer,'shared/src/index.ts'),tools=join(solutionConsumer,'tools/check.ts'),probe=join(solutionConsumer,'src/Probe.tsx');
    const sharedSource=await readFile(shared,'utf8'),toolSource=await readFile(tools,'utf8'),probeSource=await readFile(probe,'utf8');
    await mkdir(join(solutionConsumer,'shared/dist'));await writeFile(join(solutionConsumer,'shared/dist/index.d.ts'),'export declare const sharedValue: number;');
    await writeFile(join(solutionConsumer,'shared/tsconfig.tsbuildinfo'),'{"version":"old-test-input"}');
    await writeFile(shared,'export const sharedValue: string = "changed";');
    await solutionCheck('solution-stale-declarations-rejected',1,/TYPECHECK_FAILED/);await writeFile(shared,sharedSource);
    await writeFile(tools,'export const invalid: string = 1;');await solutionCheck('solution-node-noCheck-rejected',1,/tools\/check.ts.*TS2322/);await writeFile(tools,toolSource);
    await writeFile(probe,'export default 123;');await solutionCheck('solution-generated-component-rejected',1,/\.cormi\/app.tsx/);await writeFile(probe,probeSource);
    await solutionCheck('solution-typecheck-recovered',0,/"mode":"solution"/);
    await withServer(solutionConsumer,'dev',async url=>{await verifyEnvironmentPage(page,url,'selected',false);assert.equal(await page.locator('#shared-value').innerText(),'Shared value: 42');assert.deepEqual(errors,[]);},['--mode','staging']);
    await execute('solution-build',solutionConsumer,solutionBin,['build','--mode','staging','--json','--startup-timeout','30000']);
    const beforePreview=await compilerFootprint(solutionConsumer);
    await withServer(solutionConsumer,'preview',async url=>{await verifyEnvironmentPage(page,url,'selected',true);assert.equal(await page.locator('#shared-value').innerText(),'Shared value: 42');assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'typescript-solution-preview.png')});},['--mode','staging']);
    assert.deepEqual(await compilerFootprint(solutionConsumer),beforePreview);
    report.stages.push({label:'installed-typescript-solution-browser-and-output-isolation',projects:summary.projects.length,virtualDeclarations:summary.virtualDeclarations,unmodifiedSourcesAndCompilerOutputs:true});

    }
    if (selected('app-runtime')) {
    const runtimeConsumer=await create('app-runtime','react');await writeAppRuntimeFixture(runtimeConsumer);
    const runtimeManifest=consumerManifest(kit,'react');runtimeManifest.dependencies['@cormijs/plugin-react']=runtimeManifest.pnpm.overrides['@cormijs/plugin-react']!;
    await writeFile(join(runtimeConsumer,'package.json'),JSON.stringify(runtimeManifest,null,2));
    await install('app-runtime-install',runtimeConsumer);await auditLinks(runtimeConsumer);
    await command('app-runtime-typecheck',runtimeConsumer,'typecheck');
    await writeFile(join(runtimeConsumer,'types.mts'),`import {defineApp,resolveAppConfig,type RuntimeConfig} from '@cormijs/runtime';import {appRuntimePlugin,type AppConfigContribution} from '@cormijs/plugin-react';
const config=defineApp({async render(next){await next();},rootContainer:node=>node,onRouteChange({location,isFirst,action}){const path:string=location.pathname;void [isFirst,action,path];}});
resolveAppConfig({default:config});const row:AppConfigContribution={id:'x',keys:['extensionKey']};void [row,appRuntimePlugin];
// @ts-expect-error invalid runtime key must not silently become any
const wrong=defineApp({unknownHook:42});
// @ts-expect-error mixed named and default exports are not supported
resolveAppConfig({default:config,setup(){}});
`);
    await execute('app-runtime-public-types',runtimeConsumer,process.execPath,typeArguments);
    await writeFile(join(runtimeConsumer,'src/app.tsx'),'export const unknownHook=42;');
    await command('app-runtime-invalid-export',runtimeConsumer,'typecheck',1,/TYPECHECK_FAILED/);
    await writeFile(join(runtimeConsumer,'src/app.tsx'),appRuntimeSource);await command('app-runtime-types-repaired',runtimeConsumer,'typecheck');
    await withServer(runtimeConsumer,'dev',async url=>{await verifyAppRuntimePage(page,url);assert.deepEqual(errors,[]);});
    await command('app-runtime-build',runtimeConsumer,'build');
    const runtimeEntry=await readFile(join(runtimeConsumer,'.cormi/app.tsx'));
    await writeFile(join(runtimeConsumer,'src/app.tsx'),appRuntimeSource.replaceAll('Application runtime','Unbuilt source'));
    await withServer(runtimeConsumer,'preview',async url=>{await verifyAppRuntimePage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'app-runtime-preview.png')});});
    assert.deepEqual(await readFile(join(runtimeConsumer,'.cormi/app.tsx')),runtimeEntry);
    report.stages.push({label:'installed-app-runtime-initialization-routes-and-static-preview',nodeEvaluation:false,events:['POP','PUSH','POP','REPLACE'],convention:'src/app.tsx',previewRegenerated:false});

    }
    if (selected('config-routes')) {
    const routesConsumer=await create('config-routes','react');await writeConfigRoutesFixture(routesConsumer);
    const routesManifest=consumerManifest(kit,'react');
    routesManifest.dependencies['@cormijs/plugin-react']=routesManifest.pnpm.overrides['@cormijs/plugin-react']!;
    routesManifest.dependencies['@cormijs/routes']=routesManifest.pnpm.overrides['@cormijs/routes']!;
    await writeFile(join(routesConsumer,'package.json'),JSON.stringify(routesManifest,null,2));
    await install('config-routes-install',routesConsumer);await auditLinks(routesConsumer);
    await command('config-routes-typecheck',routesConsumer,'typecheck');
    await writeFile(join(routesConsumer,'types.mts'),`import {layoutPlugin,routeConfigPlugin,type ConfigRoute,type LayoutPluginOptions} from '@cormijs/plugin-react';import {expandRouteConfig} from '@cormijs/routes';
const config:readonly ConfigRoute[]=[{id:'root',path:'/',component:'./src/pages/Home.tsx',routes:[{index:true,component:'./src/pages/Home.tsx'}]},{path:'legacy/:id',redirect:'/home',keepQuery:true}];
const wrapped:ConfigRoute={path:'wrapped',component:'./src/pages/Home.tsx',wrappers:['./src/wrappers/Auth.tsx']};
const bare:ConfigRoute={path:'bare',component:'./src/pages/Home.tsx',layout:false};
const guarded:ConfigRoute={path:'admin',component:'./src/pages/Home.tsx',access:'canAdmin'};
const layout:LayoutPluginOptions={id:'consumer:layout',files:['src/layouts/index.tsx']};
const records=expandRouteConfig(config,{pluginId:'consumer:routes'});const id:string=records[0]!.id;void [id,routeConfigPlugin,layoutPlugin,wrapped,bare,guarded,layout];
// @ts-expect-error unknown configured route fields must not silently become any
const unknown:ConfigRoute={path:'x',component:'./src/pages/Home.tsx',children:[]};
// @ts-expect-error component is a project-relative source string
const bad:ConfigRoute={path:'x',component:42};
// @ts-expect-error redirect is an internal absolute path string
const badRedirect:ConfigRoute={path:'x',redirect:42};
// @ts-expect-error keepQuery is boolean
const badQuery:ConfigRoute={path:'x',redirect:'/y',keepQuery:'yes'};
// @ts-expect-error wrappers are source file strings
const badWrapper:ConfigRoute={path:'x',component:'./src/pages/Home.tsx',wrappers:[1]};
// @ts-expect-error layout only supports false
const badLayout:ConfigRoute={path:'x',component:'./src/pages/Home.tsx',layout:true};
// @ts-expect-error access is a string key
const badAccess:ConfigRoute={path:'x',component:'./src/pages/Home.tsx',access:1};
`);
    await execute('config-routes-public-types',routesConsumer,process.execPath,typeArguments);
    await withServer(routesConsumer,'dev',async url=>{await verifyConfigRoutesPage(page,url,false);assert.deepEqual(errors,[]);});
    await command('config-routes-build',routesConsumer,'build');
    const routesEntry=await readFile(join(routesConsumer,'.cormi/app.tsx')),aboutPage=join(routesConsumer,'src/pages/About.tsx'),aboutSource=await readFile(aboutPage,'utf8');
    await writeFile(aboutPage,aboutSource.replace('About config','Unbuilt route source'));
    await withServer(routesConsumer,'preview',async url=>{await verifyConfigRoutesPage(page,url,false);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'config-routes-preview.png')});});
    assert.deepEqual(await readFile(join(routesConsumer,'.cormi/app.tsx')),routesEntry);
    report.stages.push({label:'installed-config-routes-nested-index-params-and-static-preview',convention:'explicit app.routes',previewRegenerated:false});

    }
    if (selected('conventions')) {
    const conventionsConsumer=await create('conventions','react');await writeConventionsFixture(conventionsConsumer);
    const conventionsManifest=consumerManifest(kit,'react');
    conventionsManifest.dependencies['@cormijs/plugin-react']=conventionsManifest.pnpm.overrides['@cormijs/plugin-react']!;
    conventionsManifest.dependencies['@cormijs/routes']=conventionsManifest.pnpm.overrides['@cormijs/routes']!;
    await writeFile(join(conventionsConsumer,'package.json'),JSON.stringify(conventionsManifest,null,2));
    await install('conventions-install',conventionsConsumer);await auditLinks(conventionsConsumer);
    await command('conventions-typecheck',conventionsConsumer,'typecheck');
    await writeFile(join(conventionsConsumer,'types.mts'),`import {loadingPlugin,type LoadingPluginOptions} from '@cormijs/plugin-react';
const loading:LoadingPluginOptions={id:'consumer:loading',files:['src/loading.tsx']};
void [loadingPlugin,loading];
// @ts-expect-error loading files are source path strings
const bad:LoadingPluginOptions={files:[1]};
`);
    await execute('conventions-public-types',conventionsConsumer,process.execPath,typeArguments);
    await withServer(conventionsConsumer,'dev',async url=>{await verifyConventionsPage(page,url);assert.deepEqual(errors,[]);});
    await command('conventions-build',conventionsConsumer,'build');
    await withServer(conventionsConsumer,'preview',async url=>{await verifyConventionsPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'conventions-preview.png')});});
    report.stages.push({label:'installed-conventions-custom-404-loading-and-static-preview',convention:'src/pages/404.tsx + src/loading.tsx',previewRegenerated:false});

    }
    if (selected('history')) {
    const historyConsumer=await create('history','react');await writeHistoryFixture(historyConsumer,'hash','/history/');
    const historyManifest=consumerManifest(kit,'react');
    historyManifest.dependencies['@cormijs/plugin-react']=historyManifest.pnpm.overrides['@cormijs/plugin-react']!;
    await writeFile(join(historyConsumer,'package.json'),JSON.stringify(historyManifest,null,2));
    await install('history-install',historyConsumer);await auditLinks(historyConsumer);
    await command('history-typecheck',historyConsumer,'typecheck');
    await writeFile(join(historyConsumer,'types.mts'),`import type {HistoryType} from '@cormijs/plugin-react';import {Link,useNavigate,useSearchParams,type RouteChangeEvent} from '@cormijs/runtime';
const history:HistoryType='hash';const eventHistory:RouteChangeEvent['history']=history;void [history,eventHistory,Link,useNavigate,useSearchParams];
// @ts-expect-error history selection is a closed union
const bad:HistoryType='abstract';
`);
    await execute('history-public-types',historyConsumer,process.execPath,typeArguments);
    await withServer(historyConsumer,'dev',async url=>{await verifyHistoryPage(page,url,'hash','/history/');assert.deepEqual(errors,[]);});
    await command('history-build',historyConsumer,'build');
    await withServer(historyConsumer,'preview',async url=>{await verifyHistoryPage(page,url,'hash','/history/');assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'history-preview.png')});});
    report.stages.push({label:'installed-history-hash-navigation-query-and-static-preview',history:'hash',previewRegenerated:false});

    }
    if (selected('model')) {
    const modelConsumer=await create('model','react');await writeModelFixture(modelConsumer);
    const modelManifest=consumerManifest(kit,'react');
    modelManifest.dependencies['@cormijs/plugin-react']=modelManifest.pnpm.overrides['@cormijs/plugin-react']!;
    await writeFile(join(modelConsumer,'package.json'),JSON.stringify(modelManifest,null,2));
    await install('model-install',modelConsumer);await auditLinks(modelConsumer);
    await command('model-typecheck',modelConsumer,'typecheck');
    await writeFile(join(modelConsumer,'types.mts'),`import {modelPlugin,type ModelPluginOptions} from '@cormijs/plugin-react';import {defineModel,modelInitializationOrder,useGlobalModelDispatch,useModel,useModelDispatch,type ModelDescriptor,type ModelSubscription,type ObjectModel} from '@cormijs/runtime';
const options:ModelPluginOptions={id:'consumer:model',extraModels:['src/extra/model.ts']};
const subscription:ModelSubscription=({dispatch})=>{void dispatch('start');return ()=>{};};
const descriptor:ModelDescriptor={namespace:'counter',model:()=>({count:0})};
const object:ObjectModel<{count:number}>=defineModel({state:{count:0},dependencies:['counter'],reducers:{increment(state){return {count:state.count+1};}}});
const objectDescriptor:ModelDescriptor={namespace:'object',model:object};
const value=useModel<{count:number}>('counter');const selected=useModel('counter',(state:{count:number})=>state.count,(a,b)=>a===b);
const dispatch=useModelDispatch('object');
const globalDispatch=useGlobalModelDispatch();
const order=modelInitializationOrder([descriptor,objectDescriptor]);
void [modelPlugin,options,subscription,descriptor,objectDescriptor,value,selected,dispatch,globalDispatch,order];
// @ts-expect-error model must be a function or object model
const bad:ModelDescriptor={namespace:'x',model:1};
`);
    await execute('model-public-types',modelConsumer,process.execPath,typeArguments);
    await withServer(modelConsumer,'dev',async url=>{await verifyModelPage(page,url);assert.deepEqual(errors,[]);});
    await command('model-build',modelConsumer,'build');
    await withServer(modelConsumer,'preview',async url=>{await verifyModelPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'model-preview.png')});});
    report.stages.push({label:'installed-model-shared-state-selector-and-static-preview',convention:'src/models',previewRegenerated:false});

    }
    if (selected('antd')) {
    const antdConsumer=await create('antd','react');await writeAntdFixture(antdConsumer);
    const antdManifest=consumerManifest(kit,'react');
    antdManifest.dependencies['@cormijs/plugin-antd']=antdManifest.pnpm.overrides['@cormijs/plugin-antd']!;
    antdManifest.dependencies['@cormijs/plugin-react']=antdManifest.pnpm.overrides['@cormijs/plugin-react']!;
    antdManifest.dependencies.antd='6.6.7';
    await writeFile(join(antdConsumer,'package.json'),JSON.stringify(antdManifest,null,2));
    await install('antd-install',antdConsumer);await auditLinks(antdConsumer);
    await command('antd-typecheck',antdConsumer,'typecheck');
    await writeFile(join(antdConsumer,'types.mts'),`import {antdPlugin,type AntdPluginOptions} from '@cormijs/plugin-antd';
const options:AntdPluginOptions={id:'consumer:antd',theme:{token:{colorPrimary:'#1677ff'},dark:false}};void [antdPlugin,options];
// @ts-expect-error theme.dark is boolean
const bad:AntdPluginOptions={theme:{dark:'yes'}};
`);
    await execute('antd-public-types',antdConsumer,process.execPath,typeArguments);
    await withServer(antdConsumer,'dev',async url=>{await verifyAntdPage(page,url);assert.deepEqual(errors,[]);});
    await command('antd-build',antdConsumer,'build');
    await withServer(antdConsumer,'preview',async url=>{await verifyAntdPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'antd-preview.png')});});
    report.stages.push({label:'installed-antd-provider-locale-theme-dev-build-preview',adapter:'@cormijs/plugin-antd',previewRegenerated:false});

    }
    if (selected('initial-state')) {
    const initialStateConsumer=await create('initial-state','react');await writeInitialStateFixture(initialStateConsumer);
    const initialStateManifest=consumerManifest(kit,'react');
    initialStateManifest.dependencies['@cormijs/plugin-react']=initialStateManifest.pnpm.overrides['@cormijs/plugin-react']!;
    await writeFile(join(initialStateConsumer,'package.json'),JSON.stringify(initialStateManifest,null,2));
    await install('initial-state-install',initialStateConsumer);await auditLinks(initialStateConsumer);
    await command('initial-state-typecheck',initialStateConsumer,'typecheck');
    await writeFile(join(initialStateConsumer,'types.mts'),`import {initialStatePlugin,type InitialStatePluginOptions} from '@cormijs/plugin-react';import {useInitialState,type InitialState} from '@cormijs/runtime';
const options:InitialStatePluginOptions={id:'consumer:initial'};
declare const state:InitialState<{user:string}>|null;
void [initialStatePlugin,options,state,useInitialState];
// @ts-expect-error initial state id is a string
const bad:InitialStatePluginOptions={id:42};
`);
    await execute('initial-state-public-types',initialStateConsumer,process.execPath,typeArguments);
    await withServer(initialStateConsumer,'dev',async url=>{await verifyInitialStatePage(page,url);assert.deepEqual(errors,[]);});
    await command('initial-state-build',initialStateConsumer,'build');
    await withServer(initialStateConsumer,'preview',async url=>{await verifyInitialStatePage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'initial-state-preview.png')});});
    report.stages.push({label:'installed-initial-state-loading-refresh-and-static-preview',convention:'getInitialState',previewRegenerated:false});

    }
    if (selected('request')) {
    const requestConsumer=await create('request','react');await writeRequestFixture(requestConsumer);
    const requestManifest=consumerManifest(kit,'react');
    requestManifest.dependencies['@cormijs/plugin-react']=requestManifest.pnpm.overrides['@cormijs/plugin-react']!;
    await writeFile(join(requestConsumer,'package.json'),JSON.stringify(requestManifest,null,2));
    await install('request-install',requestConsumer);await auditLinks(requestConsumer);
    await command('request-typecheck',requestConsumer,'typecheck');
    await writeFile(join(requestConsumer,'types.mts'),`import {requestPlugin,type RequestPluginOptions} from '@cormijs/plugin-react';import {RequestError,usePagination,useRequest,type PaginationResponse,type RequestClient,type RequestConfig,type RequestOptions,type UsePaginationResult,type UseRequestOptions,type UseRequestResult} from '@cormijs/runtime';
const config:RequestConfig={baseURL:'/api',headers:{'x-app':'cormi'},timeout:1000,cacheLimit:10};
const options:RequestPluginOptions={id:'consumer:request'};
const hookOptions:UseRequestOptions<string>={retry:2,retryDelay:attempt=>attempt*10,pollingInterval:1000,pollingWhenHidden:false,refreshDeps:['q'],debounceWait:50,throttleWait:0};
const cacheOptions:RequestOptions={cacheTime:5000,cacheBust:true,cacheTags:['group']};
declare const pagination:UsePaginationResult<{id:number}>;
declare const pageResponse:PaginationResponse<{id:number}>;
declare const client:RequestClient;declare const result:UseRequestResult<string>;const removed:number=client.invalidateCache(['group']);
void [requestPlugin,options,hookOptions,cacheOptions,config,client,result,useRequest,usePagination,pagination,pageResponse,removed,RequestError];
// @ts-expect-error retry is a number
const badHook:UseRequestOptions<string>={retry:'2'};
// @ts-expect-error baseURL must be a string
const bad:RequestConfig={baseURL:42};
`);
    await execute('request-public-types',requestConsumer,process.execPath,typeArguments);
    await withServer(requestConsumer,'dev',async url=>{await verifyRequestPage(page,url);assert.deepEqual(errors,[]);});
    await command('request-build',requestConsumer,'build');
    await withServer(requestConsumer,'preview',async url=>{await verifyRequestPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'request-preview.png')});});
    report.stages.push({label:'installed-request-useRequest-cancel-errors-and-static-preview',hooks:'useRequest',previewRegenerated:false});

    }
    if (selected('locale')) {
    const localeConsumer=await create('locale','react');await writeLocaleFixture(localeConsumer);
    const localeManifest=consumerManifest(kit,'react');
    localeManifest.dependencies['@cormijs/plugin-react']=localeManifest.pnpm.overrides['@cormijs/plugin-react']!;
    await writeFile(join(localeConsumer,'package.json'),JSON.stringify(localeManifest,null,2));
    await install('locale-install',localeConsumer);await auditLinks(localeConsumer);
    await command('locale-typecheck',localeConsumer,'typecheck');
    await writeFile(join(localeConsumer,'types.mts'),`import {localePlugin,type LocalePluginOptions} from '@cormijs/plugin-react';import {FormattedMessage,dayjsLocaleCandidates,formatIcu,formatIcuParts,formatRelativeTimeFor,localeCandidates,localeDirection,normalizeLocaleTag,resolveLocaleResource,useIntl,useLocaleResource,type IntlApi,type LocaleConfig,type RichPart,type RichTags,type UiLocaleResource} from '@cormijs/runtime';
const config:LocaleConfig={default:'en',messages:{en:{hello:'Hello'}}};
const options:LocalePluginOptions={id:'consumer:locale'};
const formatted:string=formatIcu('{count, plural, one {# item} other {# items}}',{count:1},'en');
const relative:string=formatRelativeTimeFor('en',-2,'day');
const parts:readonly RichPart[]=formatIcuParts('<b>x</b>',{},'en',['b']);
const tags:RichTags={b:chunks=>chunks};
declare const intl:IntlApi;const richNode=intl.rich('x',{},tags);const stopLocale=intl.subscribe(()=>{});const tag=normalizeLocaleTag('zh_CN');const chain=localeCandidates('zh-Hant-TW');const dayjsNames=dayjsLocaleCandidates('zh-CN');const hit=resolveLocaleResource('en_US',{en_US:'x'});const ui:UiLocaleResource<string>={locale:'en',direction:localeDirection('ar')};
void [localePlugin,options,config,intl,useIntl,useLocaleResource,FormattedMessage,formatted,relative,parts,richNode,stopLocale,tag,chain,dayjsNames,hit,ui];
// @ts-expect-error message values are strings
const bad:LocaleConfig={messages:{en:{hello:1}}};
// @ts-expect-error ICU values are strings or numbers
formatIcu('{n, number}',{n:true},'en');
// @ts-expect-error relative time units are constrained
formatRelativeTimeFor('en',1,'fortnight');
`);
    await execute('locale-public-types',localeConsumer,process.execPath,typeArguments);
    await withServer(localeConsumer,'dev',async url=>{await verifyLocalePage(page,url);assert.deepEqual(errors,[]);});
    await command('locale-build',localeConsumer,'build');
    await withServer(localeConsumer,'preview',async url=>{await verifyLocalePage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'locale-preview.png')});});
    report.stages.push({label:'installed-locale-switch-fallback-persistence-and-static-preview',hooks:'useIntl',previewRegenerated:false});

    }
    if (selected('access')) {
    const accessConsumer=await create('access','react');await writeAccessFixture(accessConsumer);
    const accessManifest=consumerManifest(kit,'react');
    accessManifest.dependencies['@cormijs/plugin-react']=accessManifest.pnpm.overrides['@cormijs/plugin-react']!;
    await writeFile(join(accessConsumer,'package.json'),JSON.stringify(accessManifest,null,2));
    await install('access-install',accessConsumer);await auditLinks(accessConsumer);
    await command('access-typecheck',accessConsumer,'typecheck');
    await writeFile(join(accessConsumer,'types.mts'),`import {accessPlugin,type AccessPluginOptions} from '@cormijs/plugin-react';import {Access,useAccess,type AccessConfig,type AccessMap} from '@cormijs/runtime';
const config:AccessConfig=state=>({canAdmin:Boolean(state)});
const options:AccessPluginOptions={id:'consumer:access'};
declare const map:AccessMap;void [accessPlugin,options,config,map,Access,useAccess];
// @ts-expect-error access values are booleans
const bad:AccessConfig=()=>({canAdmin:'yes'});
`);
    await execute('access-public-types',accessConsumer,process.execPath,typeArguments);
    await withServer(accessConsumer,'dev',async url=>{await verifyAccessPage(page,url);assert.deepEqual(errors,[]);});
    await command('access-build',accessConsumer,'build');
    await withServer(accessConsumer,'preview',async url=>{await verifyAccessPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'access-preview.png')});});
    report.stages.push({label:'installed-access-from-initial-state-and-static-preview',hooks:'useAccess',previewRegenerated:false});

    }
    if (selected('menu')) {
    const menuConsumer=await create('menu','react');await writeMenuFixture(menuConsumer);
    const menuManifest=consumerManifest(kit,'react');
    menuManifest.dependencies['@cormijs/plugin-react']=menuManifest.pnpm.overrides['@cormijs/plugin-react']!;
    menuManifest.dependencies['@cormijs/routes']=menuManifest.pnpm.overrides['@cormijs/routes']!;
    await writeFile(join(menuConsumer,'package.json'),JSON.stringify(menuManifest,null,2));
    await install('menu-install',menuConsumer);await auditLinks(menuConsumer);
    await command('menu-typecheck',menuConsumer,'typecheck');
    await writeFile(join(menuConsumer,'types.mts'),`import {menuPlugin,type MenuPluginOptions} from '@cormijs/plugin-react';import {toAntdMenuItems,toLayoutRoutes,useBreadcrumb,useMenu,type AntdMenuItem,type BreadcrumbItem,type LayoutRoute,type MenuItem} from '@cormijs/runtime';
const options:MenuPluginOptions={id:'consumer:menu'};
declare const menu:readonly MenuItem[];declare const crumbs:readonly BreadcrumbItem[];
const antdItems:readonly AntdMenuItem[]=toAntdMenuItems(menu);
const layoutRoutes:readonly LayoutRoute[]=toLayoutRoutes(menu);
void [menuPlugin,options,menu,crumbs,useMenu,useBreadcrumb,antdItems,layoutRoutes];
// @ts-expect-error menu titles are strings
const bad:MenuItem['title']=42;
`);
    await execute('menu-public-types',menuConsumer,process.execPath,typeArguments);
    await withServer(menuConsumer,'dev',async url=>{await verifyMenuPage(page,url);assert.deepEqual(errors,[]);});
    await command('menu-build',menuConsumer,'build');
    await withServer(menuConsumer,'preview',async url=>{await verifyMenuPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'menu-preview.png')});});
    report.stages.push({label:'installed-menu-breadcrumb-access-filter-and-static-preview',hooks:'useMenu',previewRegenerated:false});

    }
    if (selected('html')) {
    const htmlConsumer=await create('html','react');await writeHtmlFixture(htmlConsumer);
    const htmlManifest=consumerManifest(kit,'react');
    htmlManifest.dependencies['@cormijs/plugin-react-vite']=htmlManifest.pnpm.overrides['@cormijs/plugin-react-vite']!;
    await writeFile(join(htmlConsumer,'package.json'),JSON.stringify(htmlManifest,null,2));
    await install('html-install',htmlConsumer);await auditLinks(htmlConsumer);
    await command('html-typecheck',htmlConsumer,'typecheck');
    await writeFile(join(htmlConsumer,'types.mts'),`import {applyHtmlHead,htmlPlugin,type HtmlPluginOptions} from '@cormijs/plugin-react-vite';
const options:HtmlPluginOptions={title:'T',lang:'zh-CN',metas:[{name:'description',content:'D'}]};
const output:string=applyHtmlHead('<html><head></head></html>',options);void [htmlPlugin,options,output];
// @ts-expect-error meta content is required
const bad:HtmlPluginOptions={metas:[{name:'description'}]};
`);
    await execute('html-public-types',htmlConsumer,process.execPath,typeArguments);
    await withServer(htmlConsumer,'dev',async url=>{await verifyHtmlPage(page,url);assert.deepEqual(errors,[]);});
    await command('html-build',htmlConsumer,'build');
    await withServer(htmlConsumer,'preview',async url=>{await verifyHtmlPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'html-preview.png')});});
    report.stages.push({label:'installed-html-head-dev-build-and-static-preview',options:'title/lang/meta/link/favicon',previewRegenerated:false});

    }
    if (selected('mock')) {
    const mockConsumer=await create('mock','react');await writeMockFixture(mockConsumer);
    const mockManifest=consumerManifest(kit,'react');
    mockManifest.dependencies['@cormijs/plugin-dev-api']=mockManifest.pnpm.overrides['@cormijs/plugin-dev-api']!;
    await writeFile(join(mockConsumer,'package.json'),JSON.stringify(mockManifest,null,2));
    await install('mock-install',mockConsumer);await auditLinks(mockConsumer);
    await command('mock-typecheck',mockConsumer,'typecheck');
    await writeFile(join(mockConsumer,'types.mts'),`import {mockPlugin,type MockPluginOptions} from '@cormijs/plugin-dev-api';import {devApiVitePlugin} from '@cormijs/plugin-dev-api/vite';
const options:MockPluginOptions={id:'consumer:mock',intervalMs:200,prefix:'/api'};void [mockPlugin,devApiVitePlugin,options];
// @ts-expect-error interval must be numeric
const bad:MockPluginOptions={intervalMs:'fast'};
`);
    await execute('mock-public-types',mockConsumer,process.execPath,typeArguments);
    await withServer(mockConsumer,'dev',async url=>{await verifyMockPage(page,url);assert.deepEqual(errors,[]);});
    await command('mock-build',mockConsumer,'build');
    await withServer(mockConsumer,'preview',async url=>{await page.goto(url);await page.getByRole('heading',{name:'Mock home',exact:true}).waitFor();assert.equal(await page.locator('[data-dev]').innerText(),'false');assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'mock-preview.png')});});
    report.stages.push({label:'installed-mock-convention-dev-build-and-preview',mockDirectory:'mock',previewRegenerated:false});

    }
    if (selected('alias')) {
    const aliasConsumer=await create('alias','react');await writeAliasFixture(aliasConsumer);
    const aliasManifest=consumerManifest(kit,'react');
    aliasManifest.dependencies['@cormijs/plugin-react-vite']=aliasManifest.pnpm.overrides['@cormijs/plugin-react-vite']!;
    await writeFile(join(aliasConsumer,'package.json'),JSON.stringify(aliasManifest,null,2));
    await install('alias-install',aliasConsumer);await auditLinks(aliasConsumer);
    await command('alias-typecheck',aliasConsumer,'typecheck');
    await writeFile(join(aliasConsumer,'types.mts'),`import {aliasPlugin,resolveAliases,type AliasPluginOptions,type ViteAlias} from '@cormijs/plugin-react-vite';
const options:AliasPluginOptions={aliases:{'@':'src'}};
const resolved:readonly ViteAlias[]=resolveAliases(process.cwd(),{'@':'src'});void [aliasPlugin,options,resolved];
// @ts-expect-error alias replacement must be a string
const bad:AliasPluginOptions={aliases:{'@':1}};
`);
    await execute('alias-public-types',aliasConsumer,process.execPath,typeArguments);
    await withServer(aliasConsumer,'dev',async url=>{await verifyAliasPage(page,url);assert.deepEqual(errors,[]);});
    await command('alias-build',aliasConsumer,'build');
    await withServer(aliasConsumer,'preview',async url=>{await verifyAliasPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'alias-preview.png')});});
    report.stages.push({label:'installed-alias-resolution-dev-build-and-static-preview',aliases:{'@':'src','@shared':'src/shared'},previewRegenerated:false});

    }
    if (selected('define')) {
    const defineConsumer=await create('define','react');await writeDefineFixture(defineConsumer);
    const defineManifest=consumerManifest(kit,'react');
    defineManifest.dependencies['@cormijs/plugin-react-vite']=defineManifest.pnpm.overrides['@cormijs/plugin-react-vite']!;
    await writeFile(join(defineConsumer,'package.json'),JSON.stringify(defineManifest,null,2));
    await install('define-install',defineConsumer);await auditLinks(defineConsumer);
    await command('define-typecheck',defineConsumer,'typecheck');
    await writeFile(join(defineConsumer,'types.mts'),`import {definePlugin,resolveDefines,mergeDefines,type DefinePluginOptions,type DefineEntry} from '@cormijs/plugin-react-vite';
const options:DefinePluginOptions={values:{APP_NAME:'cormi'}};
const entries:readonly DefineEntry[]=resolveDefines({APP_NAME:'cormi'});
const merged:Record<string,string>=mergeDefines({OTHER:'"keep"'},entries);void [definePlugin,options,merged];
// @ts-expect-error values is required
const bad:DefinePluginOptions={};
`);
    await execute('define-public-types',defineConsumer,process.execPath,typeArguments);
    await withServer(defineConsumer,'dev',async url=>{await verifyDefinePage(page,url);assert.deepEqual(errors,[]);});
    await command('define-build',defineConsumer,'build');
    await withServer(defineConsumer,'preview',async url=>{await verifyDefinePage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'define-preview.png')});});
    report.stages.push({label:'installed-define-and-builtin-alias-dev-build-and-static-preview',values:{APP_NAME:'cormi define',APP_FLAGS:{beta:true,retries:2},'process.env.APP_MODE':'fixture-mode'},builtins:true,previewRegenerated:false});

    }
    if (selected('global-style')) {
    const styleConsumer=await create('global-style','react');await writeGlobalStyleFixture(styleConsumer);
    const styleManifest=consumerManifest(kit,'react');
    styleManifest.dependencies['@cormijs/plugin-react']=styleManifest.pnpm.overrides['@cormijs/plugin-react']!;
    await writeFile(join(styleConsumer,'package.json'),JSON.stringify(styleManifest,null,2));
    await install('global-style-install',styleConsumer);await auditLinks(styleConsumer);
    await command('global-style-typecheck',styleConsumer,'typecheck');
    await writeFile(join(styleConsumer,'types.mts'),`import {globalStylePlugin,styleContributions,resolveGlobalStyles,type GlobalStylePluginOptions,type StyleContribution} from '@cormijs/plugin-react';
const options:GlobalStylePluginOptions={id:'app:styles',files:['src/global.css']};
const contributions:readonly StyleContribution[]=styleContributions([{id:'app:styles',files:['src/global.css']}]);
void [globalStylePlugin,options,contributions,resolveGlobalStyles(process.cwd(),contributions)];
// @ts-expect-error global style files must be a string array
const bad:GlobalStylePluginOptions={files:1};
`);
    await execute('global-style-public-types',styleConsumer,process.execPath,typeArguments);
    await withServer(styleConsumer,'dev',async url=>{await verifyGlobalStylePage(page,url);assert.deepEqual(errors,[]);});
    await command('global-style-build',styleConsumer,'build');
    await withServer(styleConsumer,'preview',async url=>{await verifyGlobalStylePage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'global-style-preview.png')});});
    report.stages.push({label:'installed-global-style-convention-dev-build-and-static-preview',files:['src/global.css'],previewRegenerated:false});

    }
    if (selected('access-convention')) {
    const accessConvConsumer=await create('access-convention','react');await writeAccessConventionFixture(accessConvConsumer);
    const accessConvManifest=consumerManifest(kit,'react');
    accessConvManifest.dependencies['@cormijs/plugin-react']=accessConvManifest.pnpm.overrides['@cormijs/plugin-react']!;
    await writeFile(join(accessConvConsumer,'package.json'),JSON.stringify(accessConvManifest,null,2));
    await install('access-convention-install',accessConvConsumer);await auditLinks(accessConvConsumer);
    await command('access-convention-typecheck',accessConvConsumer,'typecheck');
    await writeFile(join(accessConvConsumer,'types.mts'),`import {accessPlugin,accessContributions,resolveAccessPlan,DEFAULT_ACCESS_FILES,type AccessPluginOptions,type AccessContribution} from '@cormijs/plugin-react';
const options:AccessPluginOptions={id:'app:access',files:['src/access.ts']};
const contributions:readonly AccessContribution[]=accessContributions([{id:'app:access',files:DEFAULT_ACCESS_FILES}]);
void [accessPlugin,options,contributions,resolveAccessPlan(process.cwd(),contributions)];
// @ts-expect-error access files must be a string array
const bad:AccessPluginOptions={files:1};
`);
    await execute('access-convention-public-types',accessConvConsumer,process.execPath,typeArguments);
    await withServer(accessConvConsumer,'dev',async url=>{await verifyAccessConventionPage(page,url);assert.deepEqual(errors,[]);});
    await command('access-convention-build',accessConvConsumer,'build');
    await withServer(accessConvConsumer,'preview',async url=>{await verifyAccessConventionPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'access-convention-preview.png')});});
    report.stages.push({label:'installed-access-convention-dev-build-and-static-preview',files:['src/access.ts','src/access.tsx'],previewRegenerated:false});

    }
    if (selected('locale-catalog')) {
    const localeCatalogConsumer=await create('locale-catalog','react');await writeLocaleCatalogFixture(localeCatalogConsumer);
    const localeCatalogManifest=consumerManifest(kit,'react');
    localeCatalogManifest.dependencies['@cormijs/plugin-react']=localeCatalogManifest.pnpm.overrides['@cormijs/plugin-react']!;
    await writeFile(join(localeCatalogConsumer,'package.json'),JSON.stringify(localeCatalogManifest,null,2));
    await install('locale-catalog-install',localeCatalogConsumer);await auditLinks(localeCatalogConsumer);
    await command('locale-catalog-typecheck',localeCatalogConsumer,'typecheck');
    await writeFile(join(localeCatalogConsumer,'types.mts'),`import {localePlugin,localeCatalogSources,readLocaleCatalogs,type LocalePluginOptions,type LocaleCatalogSource} from '@cormijs/plugin-react';
const options:LocalePluginOptions={id:'app:locale',directory:'src/locales'};
const sources:readonly LocaleCatalogSource[]=localeCatalogSources([{id:'app:locale',directory:'src/locales'}]);
void [localePlugin,options,sources,readLocaleCatalogs(process.cwd(),sources)];
// @ts-expect-error locale directory must be a string
const bad:LocalePluginOptions={directory:1};

`);
    await execute('locale-catalog-public-types',localeCatalogConsumer,process.execPath,typeArguments);
    await withServer(localeCatalogConsumer,'dev',async url=>{await verifyLocaleCatalogPage(page,url);assert.deepEqual(errors,[]);});
    await command('locale-catalog-build',localeCatalogConsumer,'build');
    await withServer(localeCatalogConsumer,'preview',async url=>{await verifyLocaleCatalogPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'locale-catalog-preview.png')});});
    report.stages.push({label:'installed-locale-catalog-dev-build-and-static-preview',directory:'src/locales',locales:['en','zh-CN'],previewRegenerated:false});

    }
    if (selected('client-loader')) {
    const loaderConsumer=await create('client-loader','react');await writeClientLoaderFixture(loaderConsumer);
    const loaderManifest=consumerManifest(kit,'react');
    loaderManifest.dependencies['@cormijs/plugin-react']=loaderManifest.pnpm.overrides['@cormijs/plugin-react']!;
    await writeFile(join(loaderConsumer,'package.json'),JSON.stringify(loaderManifest,null,2));
    await install('client-loader-install',loaderConsumer);await auditLinks(loaderConsumer);
    await command('client-loader-typecheck',loaderConsumer,'typecheck');
    await writeFile(join(loaderConsumer,'types.mts'),`import {useClientLoaderData,clientLoaderOf,type ClientLoaderArgs,type ClientLoaderFunction} from '@cormijs/runtime';
const loader:ClientLoaderFunction=({params}:ClientLoaderArgs)=>({id:params.id});
void [loader,useClientLoaderData,clientLoaderOf({clientLoader:loader},"clientLoader","route:id")];
// @ts-expect-error clientLoader must be a function
const bad:ClientLoaderFunction=1;
`);
    await execute('client-loader-public-types',loaderConsumer,process.execPath,typeArguments);
    await withServer(loaderConsumer,'dev',async url=>{await verifyClientLoaderPage(page,url);assert.deepEqual(errors,[]);});
    await command('client-loader-build',loaderConsumer,'build');
    await withServer(loaderConsumer,'preview',async url=>{await verifyClientLoaderPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'client-loader-preview.png')});});
    report.stages.push({label:'installed-route-client-loader-dev-build-and-static-preview',routes:['member/:id'],previewRegenerated:false});

    }
    if (selected('route-head')) {
    const headConsumer=await create('route-head','react');await writeHeadFixture(headConsumer);
    const headManifest=consumerManifest(kit,'react');
    headManifest.dependencies['@cormijs/plugin-react']=headManifest.pnpm.overrides['@cormijs/plugin-react']!;
    await writeFile(join(headConsumer,'package.json'),JSON.stringify(headManifest,null,2));
    await install('route-head-install',headConsumer);await auditLinks(headConsumer);
    await command('route-head-typecheck',headConsumer,'typecheck');
    await writeFile(join(headConsumer,'types.mts'),`import {headPlugin,type HeadPluginOptions} from '@cormijs/plugin-react';
import {collectHead,Helmet,HeadProvider,headRuntime,mergeHeads,normalizeHead,HEAD_ATTRIBUTE,type RouteHead} from '@cormijs/runtime';
const options:HeadPluginOptions={id:'app:head',titleTemplate:' · demo'};
const head:RouteHead=normalizeHead({title:'T',metas:[{name:'description',content:'D'}]});
const collected:RouteHead=collectHead([]," / ");
const merged:RouteHead=mergeHeads(head,[]);void [headPlugin,options,head,collected,merged,Helmet,HeadProvider,headRuntime,HEAD_ATTRIBUTE];
// @ts-expect-error titleTemplate must be a string
const bad:HeadPluginOptions={titleTemplate:1};
`);
    await execute('route-head-public-types',headConsumer,process.execPath,typeArguments);
    await withServer(headConsumer,'dev',async url=>{await verifyHeadPage(page,url);assert.deepEqual(errors,[]);});
    await command('route-head-build',headConsumer,'build');
    await withServer(headConsumer,'preview',async url=>{await verifyHeadPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'route-head-preview.png')});});
    report.stages.push({label:'installed-route-head-dev-build-and-static-preview',meta:'meta.head',titleTemplate:' · demo',previewRegenerated:false});

    }
    if (selected('ssr')) {
    const ssrConsumer=await create('ssr','react');await writeSsrFixture(ssrConsumer);
    const ssrManifest=consumerManifest(kit,'react');
    ssrManifest.dependencies['@cormijs/plugin-react']=ssrManifest.pnpm.overrides['@cormijs/plugin-react']!;
    ssrManifest.dependencies['@cormijs/plugin-react-vite']=ssrManifest.pnpm.overrides['@cormijs/plugin-react-vite']!;
    await writeFile(join(ssrConsumer,'package.json'),JSON.stringify(ssrManifest,null,2));
    await install('ssr-install',ssrConsumer);await auditLinks(ssrConsumer);
    await command('ssr-typecheck',ssrConsumer,'typecheck');
    await writeFile(join(ssrConsumer,'types.mts'),`import {ssrPlugin,servePlugin,prerenderPages,prerenderStaticPages,resolvePrerenderPaths,sitemapXml,type SsrPluginOptions,type ServePluginOptions} from '@cormijs/plugin-react-vite';
import {renderServerApplication,renderServerApplicationStream,renderServerLoaderData,serverLoaderExport,type ServerApplication,type ServerRenderResult,type ServerStreamResult,type ServerLoaderFunction} from '@cormijs/runtime/server';
import {serverLoaderOf,useServerLoaderData} from '@cormijs/runtime';
const options:SsrPluginOptions={id:'app:ssr',mountId:'root',prerender:true,prerenderPaths:async()=>['/users/1',{path:'/users/2',prerender:false}],prerenderIgnoreErrors:true,prerenderIncremental:true,robots:'Sitemap: {{sitemap}}',sitemap:'https://example.com',streaming:true};
const resolvedPaths:Promise<readonly string[]>=resolvePrerenderPaths(options.prerenderPaths);
const serve:ServePluginOptions={id:'app:serve',base:'/app/',streaming:true};
declare const app:ServerApplication;
const loader:ServerLoaderFunction=({params})=>params;
const bound:ServerLoaderFunction=serverLoaderExport({},'serverLoader','route');
const render:(request:Request)=>Promise<ServerRenderResult|Response>=request=>renderServerApplication({...app,serverLoaders:{route:loader}},request);
const stream:(request:Request)=>Promise<ServerStreamResult|Response>=request=>renderServerApplicationStream(app,request);
const load:(request:Request)=>Promise<Response>=request=>renderServerLoaderData(app,request);
void [ssrPlugin,servePlugin,options,resolvedPaths,serve,render,stream,load,loader,bound,serverLoaderOf,useServerLoaderData,prerenderPages,prerenderStaticPages,sitemapXml];
// @ts-expect-error mountId is a string
const bad:SsrPluginOptions={mountId:1};
// @ts-expect-error sitemap must be a string
const badSitemap:SsrPluginOptions={prerender:true,sitemap:1};
// @ts-expect-error streaming is boolean
const badStreaming:SsrPluginOptions={streaming:1};
`);
    await execute('ssr-public-types',ssrConsumer,process.execPath,typeArguments);
    await command('ssr-build',ssrConsumer,'build');
    assert.ok(existsSync(join(ssrConsumer,'dist/.cormi/ssr/ssr.mjs')));
    await withServer(ssrConsumer,'preview',async url=>{await verifySsrPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'ssr-preview.png')});});
    await withServer(ssrConsumer,'serve',async url=>{await verifySsrPage(page,url);assert.deepEqual(errors,[]);});
    report.stages.push({label:'installed-ssr-build-hydrated-preview-and-serve',serverLoader:true,serveCommand:true,previewRegenerated:false});

    }
    if (selected('prefetch')) {
    const prefetchConsumer=await create('prefetch','react');await writePrefetchFixture(prefetchConsumer);
    const prefetchManifest=consumerManifest(kit,'react');
    prefetchManifest.dependencies['@cormijs/plugin-react']=prefetchManifest.pnpm.overrides['@cormijs/plugin-react']!;
    await writeFile(join(prefetchConsumer,'package.json'),JSON.stringify(prefetchManifest,null,2));
    await install('prefetch-install',prefetchConsumer);await auditLinks(prefetchConsumer);
    await command('prefetch-typecheck',prefetchConsumer,'typecheck');
    await writeFile(join(prefetchConsumer,'types.mts'),`import {routePrefetchPlugin,type RoutePrefetchOptions} from '@cormijs/plugin-react';
import {usePrefetch,usePrefetchOnVisible,type PrefetchApi,type PrefetchVisibleOptions} from '@cormijs/runtime';
const options:RoutePrefetchOptions={id:'app:prefetch',mode:'idle'};
const visible:PrefetchVisibleOptions={rootMargin:'0px',threshold:0.5,delayMs:0};
const api:PrefetchApi|null=null as unknown as PrefetchApi|null;void [routePrefetchPlugin,options,usePrefetch,usePrefetchOnVisible,visible,api];
// @ts-expect-error mode is manual or idle
const bad:RoutePrefetchOptions={mode:'later'};
// @ts-expect-error rootMargin is a string
const badVisible:PrefetchVisibleOptions={rootMargin:1};
`);
    await execute('prefetch-public-types',prefetchConsumer,process.execPath,typeArguments);
    await withServer(prefetchConsumer,'dev',async url=>{await verifyPrefetchPage(page,url,false);assert.deepEqual(errors,[]);});
    await command('prefetch-build',prefetchConsumer,'build');
    await withServer(prefetchConsumer,'preview',async url=>{await verifyPrefetchPage(page,url,true);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'prefetch-preview.png')});});
    report.stages.push({label:'installed-route-prefetch-dev-build-and-static-preview',mode:'manual',previewRegenerated:false});

    }
    if (selected('output')) {
    const outputConsumer=await create('output','react');await writeOutputFixture(outputConsumer);
    const outputManifest=consumerManifest(kit,'react');
    outputManifest.dependencies['@cormijs/plugin-react-vite']=outputManifest.pnpm.overrides['@cormijs/plugin-react-vite']!;
    await writeFile(join(outputConsumer,'package.json'),JSON.stringify(outputManifest,null,2));
    await install('output-install',outputConsumer);await auditLinks(outputConsumer);
    await command('output-typecheck',outputConsumer,'typecheck');
    await writeFile(join(outputConsumer,'types.mts'),`import {outputPlugin,resolveOutputCopy,stableOutputNames,type OutputPluginOptions,type OutputCopy} from '@cormijs/plugin-react-vite';
const options:OutputPluginOptions={hash:false,copy:[{from:'static',to:'extras'}]};
const copies:readonly OutputCopy[]=resolveOutputCopy(process.cwd(),[{from:'static'}]);
void [outputPlugin,options,copies,stableOutputNames()];
// @ts-expect-error hash must be a boolean
const bad:OutputPluginOptions={hash:1};
`);
    await execute('output-public-types',outputConsumer,process.execPath,typeArguments);
    await withServer(outputConsumer,'dev',async url=>{await page.goto(url);await page.getByRole('heading',{name:'Output home',exact:true}).waitFor();assert.deepEqual(errors,[]);});
    await command('output-build',outputConsumer,'build');
    await verifyOutputBuild(outputConsumer);
    await withServer(outputConsumer,'preview',async url=>{await verifyOutputPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'output-preview.png')});});
    report.stages.push({label:'installed-output-copy-and-stable-names-dev-build-and-static-preview',hash:false,previewRegenerated:false});

    }
    if (selected('generator')) {
    const generatorConsumer=await create('generator','react');await writeGeneratorFixture(generatorConsumer);
    const generatorManifest=consumerManifest(kit,'react');
    generatorManifest.dependencies['@cormijs/plugin-react']=generatorManifest.pnpm.overrides['@cormijs/plugin-react']!;
    await writeFile(join(generatorConsumer,'package.json'),JSON.stringify(generatorManifest,null,2));
    await install('generator-install',generatorConsumer);await auditLinks(generatorConsumer);
    await command('generator-typecheck-before',generatorConsumer,'typecheck');
    await writeFile(join(generatorConsumer,'types.mts'),`import {generatorPlugin,normalizeTemplates,planGeneration,type GeneratePlan,type GenerateTemplate,type PlannedFile} from '@cormijs/plugin-react';
const plan:GeneratePlan=planGeneration(['page','typed']);
const files:readonly PlannedFile[]=plan.files;
const template:GenerateTemplate={path:'src/notes/{{kebab}}.md',content:'# {{pascal}}'};
const custom:GeneratePlan=planGeneration(['note','typed'],normalizeTemplates({note:template}));
void [generatorPlugin,plan,files,custom];
// @ts-expect-error positionals must be an array of strings
const bad:GeneratePlan=planGeneration(1);
`);
    await execute('generator-public-types',generatorConsumer,process.execPath,typeArguments);
    const cormiBin=join(generatorConsumer,'node_modules/.bin/cormi');
    await execute('generator-page',generatorConsumer,cormiBin,['generate','page','generated','--json']);
    const generated=await readFile(join(generatorConsumer,'src/pages/generated.tsx'),'utf8');
    assert.match(generated,/export default function GeneratedPage\(\)/);
    await execute('generator-api',generatorConsumer,cormiBin,['generate','api','health','--json']);
    assert.match(await readFile(join(generatorConsumer,'src/api/health.ts'),'utf8'),/export default function handler\(request: Request\)/);
    await execute('generator-mock',generatorConsumer,cormiBin,['generate','mock','health','--json']);
    assert.match(await readFile(join(generatorConsumer,'mock/health.ts'),'utf8'),/'GET \/api\/health'/);
    await command('generator-typecheck-after',generatorConsumer,'typecheck');
    await execute('generator-exists',generatorConsumer,cormiBin,['generate','page','generated'],1,/GENERATE_EXISTS/);
    await execute('generator-page-force',generatorConsumer,cormiBin,['generate','page','generated','--json','--','--force']);
    report.stages.push({label:'installed-generator-cli-page-force-and-typecheck',kinds:['page'],previewRegenerated:false});

    }
    if (selected('static-export')) {
    const exportConsumer=await create('static-export','react');await writeStaticExportFixture(exportConsumer);
    const exportManifest=consumerManifest(kit,'react');
    exportManifest.dependencies['@cormijs/plugin-react']=exportManifest.pnpm.overrides['@cormijs/plugin-react']!;
    exportManifest.dependencies['@cormijs/plugin-react-vite']=exportManifest.pnpm.overrides['@cormijs/plugin-react-vite']!;
    await writeFile(join(exportConsumer,'package.json'),JSON.stringify(exportManifest,null,2));
    await install('static-export-install',exportConsumer);await auditLinks(exportConsumer);
    await command('static-export-typecheck',exportConsumer,'typecheck');
    await writeFile(join(exportConsumer,'types.mts'),`import {apiRoutePlugin,matchApiRoute,resolveApiRoutes,staticExportPlugin,staticPages,renderStaticPage,writeStaticPages,type ApiRoute,type ApiRoutePluginOptions,type StaticExportOptions,type StaticPage} from '@cormijs/plugin-react-vite';
const options:StaticExportOptions={id:'app:export',titleTemplate:' · demo'};
const pages:readonly StaticPage[]=staticPages([]);
const apiOptions:ApiRoutePluginOptions={id:'app:api',directory:'src/api',prefix:'/api'};
const routes:readonly ApiRoute[]=resolveApiRoutes(['src/api/ping.ts']);
const matched=matchApiRoute(routes,'/api/ping');
void [apiRoutePlugin,apiOptions,routes,matched,staticExportPlugin,options,pages,renderStaticPage('<html><head><title>x</title></head></html>',{path:'/',head:{title:'x'}}),writeStaticPages];
// @ts-expect-error titleTemplate must be a string
const bad:StaticExportOptions={titleTemplate:1};
// @ts-expect-error API prefixes are strings
const badApi:ApiRoutePluginOptions={prefix:1};
import {proxyPlugin,normalizeProxy,type ProxyPluginOptions,type NormalizedProxyTarget} from '@cormijs/plugin-react-vite';
const proxyOptions:ProxyPluginOptions={proxy:{'/api':{target:'http://127.0.0.1:8080',changeOrigin:true}}};
const proxyTargets:Readonly<Record<string,NormalizedProxyTarget>>=normalizeProxy(proxyOptions.proxy);
void [proxyPlugin,proxyTargets];
// @ts-expect-error proxy targets must be strings or bounded options
const badProxy:ProxyPluginOptions={proxy:{'/api':1}};
`);
    await execute('static-export-public-types',exportConsumer,process.execPath,typeArguments);
    await withServer(exportConsumer,'dev',async url=>{await page.goto(url);await page.getByRole('heading',{name:'Export home',exact:true}).waitFor();assert.deepEqual(errors,[]);});
    await command('static-export-build',exportConsumer,'build');
    await verifyStaticExport(exportConsumer);
    await withServer(exportConsumer,'preview',async url=>{await verifyStaticExportPages(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'static-export-preview.png')});});
    report.stages.push({label:'installed-static-export-dev-build-and-static-preview',routes:['/','/guide'],apiRoutes:['/api/ping'],previewRegenerated:false});

    }
    if (selected('mpa')) {
    const mpaConsumer=await create('mpa','react');await writeMpaFixture(mpaConsumer);
    const mpaManifest=consumerManifest(kit,'react');
    mpaManifest.dependencies['@cormijs/plugin-react-vite']=mpaManifest.pnpm.overrides['@cormijs/plugin-react-vite']!;
    await writeFile(join(mpaConsumer,'package.json'),JSON.stringify(mpaManifest,null,2));
    await install('mpa-install',mpaConsumer);await auditLinks(mpaConsumer);
    await command('mpa-typecheck',mpaConsumer,'typecheck');
    await writeFile(join(mpaConsumer,'types.mts'),`import {mpaPlugin,resolveMpaEntries,mpaEntrySource,mpaHtml,type MpaPluginOptions,type MpaEntry} from '@cormijs/plugin-react-vite';
const options:MpaPluginOptions={id:'app:mpa',directory:'src/pages',mountElementId:'root'};
const entries:readonly MpaEntry[]=resolveMpaEntries([{name:'home',file:'src/pages/home/index.tsx'}],{directory:'src/pages',mountElementId:'root'});
void [mpaPlugin,options,entries,mpaEntrySource,mpaHtml];
// @ts-expect-error mountElementId is a string
const bad:MpaPluginOptions={mountElementId:1};
`);
    await execute('mpa-public-types',mpaConsumer,process.execPath,typeArguments);
    await withServer(mpaConsumer,'dev',async url=>{await verifyMpaPages(page,url,errors);assert.deepEqual(errors,[]);});
    await command('mpa-build',mpaConsumer,'build');
    await verifyMpaOutput(mpaConsumer);
    await withServer(mpaConsumer,'preview',async url=>{await verifyMpaPages(page,url,errors);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'mpa-preview.png')});});
    report.stages.push({label:'installed-mpa-dev-build-and-static-preview',pages:['home','admin'],previewRegenerated:false});

    }
    if (selected('analytics')) {
    const analyticsConsumer=await create('analytics','react');await writeAnalyticsFixture(analyticsConsumer);
    const analyticsManifest=consumerManifest(kit,'react');
    analyticsManifest.dependencies['@cormijs/plugin-react']=analyticsManifest.pnpm.overrides['@cormijs/plugin-react']!;
    await writeFile(join(analyticsConsumer,'package.json'),JSON.stringify(analyticsManifest,null,2));
    await install('analytics-install',analyticsConsumer);await auditLinks(analyticsConsumer);
    await command('analytics-typecheck',analyticsConsumer,'typecheck');
    await writeFile(join(analyticsConsumer,'types.mts'),`import {analyticsPlugin,type AnalyticsPluginOptions} from '@cormijs/plugin-react';
import {analyticsRuntime,type AnalyticsOptions,type PageViewEvent} from '@cormijs/runtime';
const options:AnalyticsPluginOptions={id:'app:analytics',measurementId:'G-TEST1234',dispatch:true};
const page:PageViewEvent={path:'/',search:'',hash:'',title:'t',referrer:''};void [analyticsPlugin,options,analyticsRuntime,page];
// @ts-expect-error dispatch must be a boolean
const bad:AnalyticsPluginOptions={dispatch:'yes'};
`);
    await execute('analytics-public-types',analyticsConsumer,process.execPath,typeArguments);
    await withServer(analyticsConsumer,'dev',async url=>{await verifyAnalyticsPage(page,url);assert.deepEqual(errors,[]);});
    await command('analytics-build',analyticsConsumer,'build');
    await withServer(analyticsConsumer,'preview',async url=>{await verifyAnalyticsPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'analytics-preview.png')});});
    report.stages.push({label:'installed-pageview-analytics-dev-build-and-static-preview',event:'page_view',previewRegenerated:false});


    }

    if (selected('tools')) {
      const toolsConsumer=await create('tools','react');await writeToolsFixture(toolsConsumer);
      const toolsManifest=consumerManifest(kit,'react');
      toolsManifest.dependencies['@cormijs/plugin-react']=toolsManifest.pnpm.overrides['@cormijs/plugin-react']!;
      await writeFile(join(toolsConsumer,'package.json'),JSON.stringify(toolsManifest,null,2));
      await install('tools-install',toolsConsumer);await auditLinks(toolsConsumer);await writeFakeTools(toolsConsumer);
      await command('tools-typecheck',toolsConsumer,'typecheck');
      await writeFile(join(toolsConsumer,'types.mts'),`import {toolPlugin,runTool,type ToolPluginOptions,type ToolSpec} from '@cormijs/plugin-react';
const options:ToolPluginOptions={id:'app:tools',lint:{bin:'eslint',args:['.']}};
const spec:ToolSpec={bin:'prettier'};void [toolPlugin,options,spec,runTool];
// @ts-expect-error bin must be a string
const bad:ToolSpec={bin:1};
`);
      await execute('tools-public-types',toolsConsumer,process.execPath,typeArguments);
      const toolsBin=join(toolsConsumer,'node_modules/.bin/cormi');
      await execute('tools-lint',toolsConsumer,toolsBin,['lint','--json']);
      await execute('tools-lint-fail',toolsConsumer,toolsBin,['lint','--','--fail'],1,/TOOL_FAILED/);
      await execute('tools-format',toolsConsumer,toolsBin,['format','--json','--','--check']);
      report.stages.push({label:'installed-lint-format-wrapper-commands',bins:['fake-lint','fake-format'],previewRegenerated:false});
    }

    if (selected('conventional-loader')) {
      const convConsumer=await create('conventional-loader','react');await writeConventionalLoaderFixture(convConsumer);
      const convManifest=consumerManifest(kit,'react');
      convManifest.dependencies['@cormijs/plugin-react']=convManifest.pnpm.overrides['@cormijs/plugin-react']!;
      await writeFile(join(convConsumer,'package.json'),JSON.stringify(convManifest,null,2));
      await install('conventional-loader-install',convConsumer);await auditLinks(convConsumer);
      await command('conventional-loader-typecheck',convConsumer,'typecheck');
      await writeFile(join(convConsumer,'types.mts'),`import {detectClientLoader,pageLoaders,CLIENT_LOADER_EXPORT} from '@cormijs/plugin-react';
const found:string|undefined=detectClientLoader('export const clientLoader = async () => ({});');
void [found,pageLoaders,CLIENT_LOADER_EXPORT];
// @ts-expect-error source must be a string
detectClientLoader(1);
`);
      await execute('conventional-loader-public-types',convConsumer,process.execPath,typeArguments);
      await withServer(convConsumer,'dev',async url=>{await verifyConventionalLoaderPage(page,url);assert.deepEqual(errors,[]);});
      await command('conventional-loader-build',convConsumer,'build');
      await withServer(convConsumer,'preview',async url=>{await verifyConventionalLoaderPage(page,url);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'conventional-loader-preview.png')});});
      report.stages.push({label:'installed-conventional-client-loader-dev-build-and-preview',detection:'ast',previewRegenerated:false});
    }
  } finally { await browser.close(); }
  report.passed = true;
} catch (error) {
  report.retainedConsumer = temporary;
  console.error(error); process.exitCode = 1;
} finally {
  if (report.passed) await rm(temporary, {recursive:true,force:true});
  const result = join(logRoot,'result.json'); await writeFile(result, JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:report.passed,stages:report.stages.length,result,retainedConsumer:report.retainedConsumer},null,2));
}
