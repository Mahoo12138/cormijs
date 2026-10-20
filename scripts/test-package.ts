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
  return execute(label, cwd, 'pnpm', ['install', '--offline', '--ignore-scripts', '--no-frozen-lockfile'], expected, pattern);
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
async function withServer(cwd: string, name: 'dev' | 'preview', action: (url: string) => Promise<void>, args: string[] = [], carrierFile?: string) {
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
  await execute('relocated-frozen-reinstall', app, 'pnpm', ['install', '--offline', '--ignore-scripts', '--frozen-lockfile']);
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
const layout:LayoutPluginOptions={id:'consumer:layout',files:['src/layouts/index.tsx']};
const records=expandRouteConfig(config,{pluginId:'consumer:routes'});const id:string=records[0]!.id;void [id,routeConfigPlugin,layoutPlugin,wrapped,bare,layout];
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
`);
    await execute('config-routes-public-types',routesConsumer,process.execPath,typeArguments);
    await withServer(routesConsumer,'dev',async url=>{await verifyConfigRoutesPage(page,url,false);assert.deepEqual(errors,[]);});
    await command('config-routes-build',routesConsumer,'build');
    const routesEntry=await readFile(join(routesConsumer,'.cormi/app.tsx')),aboutPage=join(routesConsumer,'src/pages/About.tsx'),aboutSource=await readFile(aboutPage,'utf8');
    await writeFile(aboutPage,aboutSource.replace('About config','Unbuilt route source'));
    await withServer(routesConsumer,'preview',async url=>{await verifyConfigRoutesPage(page,url,false);assert.deepEqual(errors,[]);await page.screenshot({path:join(logRoot,'config-routes-preview.png')});});
    assert.deepEqual(await readFile(join(routesConsumer,'.cormi/app.tsx')),routesEntry);
    report.stages.push({label:'installed-config-routes-nested-index-params-and-static-preview',convention:'explicit app.routes',previewRegenerated:false});

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
