import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
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
async function withServer(cwd: string, name: 'dev' | 'preview', action: (url: string) => Promise<void>) {
  const sessionLabel = cwd.split(sep).at(-1) + '-' + name;
  const child = spawn(join(cwd, 'node_modules/.bin/cormi'), [name, '--json', '--startup-timeout', '30000'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
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
  const launcher = await create('launcher', 'launcher'); await install('launcher-install', launcher);
  await execute('launcher-bin', launcher, join(launcher, 'node_modules/.bin/cormi'), ['--help'], 0, /cormi <command>/);
  await writeFile(join(launcher, 'types.mts'), `import {defineConfig} from 'cormijs';import {runCormi} from 'cormijs/launcher';void runCormi;defineConfig({plugins:[]});`);
  await execute('launcher-types', launcher, process.execPath, typeArguments);
  await writeFile(join(launcher, 'cormi.config.ts'), `import {defineConfig} from 'cormijs';export default defineConfig({plugins:[{id:'echo',plugin:{inject:['commands'],apply(ctx){ctx.effect(()=>ctx.commands.register('echo',async()=>({kind:'result',data:'PACKED_COMMAND_OK'})))}}}]});`);
  await command('launcher-custom-command', launcher, 'echo', 0, /PACKED_COMMAND_OK/);
  await execute('launcher-no-vite', launcher, process.execPath, ['--input-type=module', '-e', `import {createRequire} from 'node:module';import assert from 'node:assert/strict';const r=createRequire(import.meta.url);assert.throws(()=>r.resolve('vite'),{code:'MODULE_NOT_FOUND'});assert.throws(()=>r.resolve('@cormijs/core/dist/index.js'),{code:'ERR_PACKAGE_PATH_NOT_EXPORTED'});`]);
  await auditLinks(launcher);
  const missing = await create('missing-peer', 'react');
  const missingManifest = consumerManifest(kit, 'react'); delete missingManifest.dependencies['react-dom'];
  await writeFile(join(missing, 'package.json'), JSON.stringify(missingManifest));
  await install('missing-peer-rejected', missing, 1, /ERR_PNPM_PEER_DEP_ISSUES/);
  const sdk = await create('sdk', 'react'); const sdkManifest = consumerManifest(kit, 'react');
  Object.assign(sdkManifest.dependencies, sdkManifest.pnpm.overrides); await writeFile(join(sdk, 'package.json'), JSON.stringify(sdkManifest));
  await install('sdk-install', sdk);
  const specifiers = kit.packages.map(item => item.name).concat('cormijs/launcher', '@cormijs/builder/development', '@cormijs/plugin-dev-api/vite');
  await writeFile(join(sdk, 'types.mts'), specifiers.map((specifier, i) => `import * as p${i} from ${JSON.stringify(specifier)};void p${i};`).join('\n'));
  await execute('all-public-types', sdk, process.execPath, typeArguments);
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
