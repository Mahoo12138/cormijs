import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, writeFile, lstat, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { createServer } from 'node:http';
import { chromium, type Page } from 'playwright-core';
import { packWorkspace, run, checked, filesUnder, sha256, packagePath } from './packaging.js';
import { listen, close, assertPortFree } from '../tests/helpers.js';
import { preparePluginAssets, verifyPluginAssets } from './plugin-assets-verify.js';
import { verifyPluginInstances } from './plugin-instances-verify.js';

// Flow: installed creator -> source plugin playground -> real tgz -> relocated independent application.
// Existing Playwright harness; the in-app Browser skill/runtime is not available in this session.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ strict: true, options: { out: { type: 'string' }, 'font-root': { type: 'string' } } });
await mkdir(join(root, '.cache'), { recursive: true });
const out = values.out ? resolve(values.out) : join(root, '.cache', 'plugin-author-' + Date.now());
await mkdir(out);
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'cormi plugin author 中文 ')));
// Absolute cache paths: inherited relative pnpm settings must not move with consumer cwd.
const env: NodeJS.ProcessEnv = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '',
  npm_config_store_dir: join(root, '.cache/pnpm-store'), npm_config_cache_dir: join(root, '.cache/pnpm-cache'),
  npm_config_state_dir: join(temporary, 'state'), npm_config_ignore_scripts: 'true', npm_config_package_import_method: 'copy',
  npm_config_userconfig: join(temporary, 'empty.npmrc'), npm_config_globalconfig: join(temporary, 'empty-global.npmrc') };
await writeFile(env.npm_config_userconfig!, ''); await writeFile(env.npm_config_globalconfig!, '');
const kitPath = join(temporary, 'kit'), creator = join(temporary, 'creator'), author = join(temporary, 'author'), consumer = join(temporary, 'consumer');
const name = '@example/hello';
const report: { passed: boolean; temporary: string; out: string; stages: Array<Record<string, unknown>>; error?: string } = { passed: false, temporary, out, stages: [] };
async function record(stage: Record<string, unknown>) { report.stages.push(stage); await writeFile(join(out, 'result.json'), JSON.stringify(report, null, 2)); }
async function execute(label: string, cwd: string, executable: string, args: string[], expected = 0): Promise<string> {
  const result = await run(executable, args, cwd, env, 120000);
  const text = result.stdout + result.stderr; const logfile = label + '-' + report.stages.length + '.log'; await writeFile(join(out, logfile), text);
  assert.equal(result.code, expected, label + '\n' + text);
  await record({ label, exitCode: result.code, log: logfile, logSha256: sha256(text) }); return result.stdout;
}
const pm = (label: string, cwd: string, args: string[], expected = 0) => execute(label, cwd, 'pnpm', args, expected);
const json = async (file: string) => JSON.parse(await readFile(file, 'utf8'));
async function installedCli(cwd: string, command: string, args: string[] = [], expected = 0) {
  return execute(cwd === author ? 'author-' + command : 'consumer-' + command, cwd, process.execPath,
    [join(cwd, 'node_modules/cormijs/dist/cli.js'), command, '--json', '--startup-timeout', '30000', ...args], expected);
}
interface Event { type: string; url?: string; generation?: number; code?: string | number; data?: any }
let serverSequence = 0;
async function server(cwd: string, command: 'dev' | 'preview', action: (url: string, wait: (predicate: (event: Event) => boolean) => Promise<Event>) => Promise<void>) {
  const events: Event[] = []; let stdout = '', stderr = '', buffer = '';
  const serverLog = (cwd === author ? 'author' : 'consumer') + '-' + command + '-' + (++serverSequence) + '-server.log';
  const child = fork(join(cwd, 'node_modules/cormijs/dist/cli.js'), [command, '--json', '--startup-timeout', '30000'], { cwd, env, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const done = new Promise<number | null>((resolveDone, reject) => { child.once('error', reject); child.once('close', resolveDone); }); void done.catch(() => {});
  child.stderr!.on('data', data => { stderr += String(data); });
  child.stdout!.on('data', data => { stdout += String(data); buffer += String(data); for (;;) {
    const i = buffer.indexOf('\n'); if (i < 0) break; const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
    try { events.push(JSON.parse(line)); } catch { /* non-JSON user log */ }
  } });
  const wait = async (predicate: (event: Event) => boolean) => {
    const end = Date.now() + 35000;
    while (Date.now() < end) { const found = events.find(predicate); if (found) return found;
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(JSON.stringify(events) + stderr);
      await delay(20);
    } throw new Error('CLI event deadline: ' + JSON.stringify(events) + stderr);
  };
  let url: string | undefined;
  try { const ready = await wait(e => e.type === 'ready'); assert.ok(ready.url); url = ready.url; await action(url, wait); }
  finally {
    if (child.connected) child.send({ version: 1, type: 'cormi:shutdown' });
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000);
    try { assert.equal(await done, 0, JSON.stringify(events) + stderr); }
    finally { clearTimeout(timer); await writeFile(join(out, serverLog), stdout + stderr); }
    assert.equal(existsSync(join(cwd, '.cormi.lock')), false);
    if (url) await assertPortFree(Number(new URL(url).port));
  }
}
async function auditLinks(cwd: string) {
  let count = 0;
  async function visit(dir: string) { for (const child of await readdir(dir)) { const path = join(dir, child), info = await lstat(path);
    if (info.isSymbolicLink()) { assert.ok((await realpath(path)).startsWith(cwd + sep), 'Link escapes own installation: ' + path); count++; }
    else if (info.isDirectory()) await visit(path);
  } }
  await visit(join(cwd, 'node_modules')); await record({ label: 'isolated-links', cwd, count });
}
async function freePort() { const s = createServer(); const port = await listen(s); await close(s); return port; }
const parseEvents = (text: string): Event[] => text.trim().split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
async function pageBasics(page: Page, url: string, label: string, development: boolean) {
  const target = new URL('plugin', url).href;
  await page.goto(target);
  assert.equal(page.url(), target);
  assert.ok((await page.title()).length > 0, 'The application must have a document title');
  await page.getByRole('heading', { name: '插件开发示例', exact: true }).waitFor();
  await page.getByText(label, { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Count: 0', exact: true }).click();
  await page.getByRole('button', { name: 'Count: 1', exact: true }).waitFor();
  assert.equal(await page.locator('cormi-development-overlay,vite-error-overlay').count(), 0);
  assert.equal(await page.getByRole('button', { name: '请求插件 API', exact: true }).isEnabled(), development);
  if (development) { await page.getByRole('button', { name: '请求插件 API', exact: true }).click(); await page.locator('output').filter({ hasText: 'Hello, ' + label + '!' }).waitFor(); }
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  const kit = await packWorkspace(root, kitPath);
  const creatorTar = kit.packages.find(p => p.name === '@cormijs/create')!;
  await mkdir(creator); await writeFile(join(creator, 'package.json'), JSON.stringify({ name: 'installed-creator', private: true, dependencies: { '@cormijs/create': 'file:' + join(kitPath, creatorTar.file) } }));
  await writeFile(join(creator, 'pnpm-workspace.yaml'), 'packages: []\n');
  await pm('creator-install', creator, ['install', '--offline', '--ignore-scripts', '--no-frozen-lockfile']);
  const bin = join(creator, 'node_modules/@cormijs/create/dist/cli.js');
  await execute('creator-plugin', creator, process.execPath, [bin, author, '--kit', kitPath, '--template', 'plugin-react', '--name', name, '--json']);
  assert.equal(existsSync(join(author, 'node_modules')), false);
  await pm('author-install', author, ['install', '--offline', '--ignore-scripts', '--no-frozen-lockfile']); await auditLinks(author);
  const configPath = join(author, 'cormi.config.ts'), generatedConfig = await readFile(configPath, 'utf8');
  const config = generatedConfig.replace('port: 8003', 'port: ' + await freePort()); await writeFile(configPath, config);
  const assetFixture = await preparePluginAssets(author,values['font-root']);
  await writeFile(join(author,'src/assets/removed.svg'),'<svg xmlns="http://www.w3.org/2000/svg"/>');
  await pm('author-build', author, ['build']); await pm('author-types', author, ['typecheck']); await pm('author-app-types', author, ['check:app']);
  assert.ok(existsSync(join(author,'dist/assets/removed.svg')));await rm(join(author,'src/assets/removed.svg'));
  await pm('author-rebuild-removes-owned-resource',author,['build']);assert.equal(existsSync(join(author,'dist/assets/removed.svg')),false);
  for(const [path,bytes] of assetFixture.files) assert.deepEqual(await readFile(join(author,'dist',path.slice(4))),bytes);
  const executablePath = process.env.CORMI_BROWSER_EXECUTABLE ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
  assert.ok(existsSync(executablePath)); browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(15000);
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  page.on('console', msg => { if (['error','warning'].includes(msg.type())) errors.push(msg.text() + ' @ ' + msg.location().url); });
  const pageFile = join(author, 'src/page.tsx'), apiFile = join(author, 'src/api.ts');
  const originalPage = await readFile(pageFile, 'utf8'), originalApi = await readFile(apiFile, 'utf8');
  try {
    await server(author, 'dev', async (url, wait) => {
      await pageBasics(page, url, 'cormi author', true);
      assert.equal(await page.title(), 'cormi plugin playground');
      await record({label:'author-assets',...(await verifyPluginAssets(page,url,assetFixture))});
      const tokenFile=join(author,'src/assets/tokens.css'), originalTokens=await readFile(tokenFile,'utf8');
      const cssOrigin=await page.evaluate(()=>performance.timeOrigin);
      try {await writeFile(tokenFile,originalTokens.replace('2px','6px'));
        await page.waitForFunction(()=>getComputedStyle(document.querySelector('main')!).borderTopWidth==='6px');
        await page.getByRole('button',{name:'Count: 1',exact:true}).waitFor();assert.equal(await page.evaluate(()=>performance.timeOrigin),cssOrigin);
      } finally {await writeFile(tokenFile,originalTokens);}
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('main')!).borderTopWidth==='2px');
      await record({label:'css-import-hot-update-preserves-state',documentUnchanged:true});
      await pm('pack-rejects-active-session', author, ['pack:plugin'], 1);
      const origin = await page.evaluate(() => performance.timeOrigin);
      await writeFile(pageFile, originalPage.replace('插件开发示例', '插件源码已更新'));
      await page.getByRole('heading', { name: '插件源码已更新', exact: true }).waitFor();
      await page.getByRole('button', { name: 'Count: 1', exact: true }).waitFor(); assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
      await page.screenshot({ path: join(out, 'author-hmr.png'), fullPage: false });
      await writeFile(pageFile, originalPage); await page.getByRole('heading', { name: '插件开发示例', exact: true }).waitFor();
      await writeFile(apiFile, originalApi.replace('Hello, ', 'Updated, '));
      await wait(e => e.type === 'ready' && e.generation === 2);
      await page.waitForFunction(old => performance.timeOrigin !== old, origin);
      await page.getByRole('button', { name: '请求插件 API', exact: true }).click(); await page.locator('output').filter({ hasText: 'Updated, cormi author!' }).waitFor();
      for (const relative of ['src/index.ts?raw', '.cormi-local/manifest.json?raw']) assert.equal((await fetch(new URL(relative, url))).status, 403);
      await writeFile(configPath, config.replace("id: 'example-plugin', plugin: feature", "id: 'example-plugin', enabled: false, plugin: feature"));
      await wait(e => e.type === 'ready' && e.generation === 3);
      await page.getByRole('heading', { name: '404', exact: true }).waitFor();
      assert.equal((await fetch(new URL('api/hello', url))).status, 404);
      await writeFile(configPath, config); await wait(e => e.type === 'ready' && e.generation === 4);
      await page.getByRole('heading', { name: '插件开发示例', exact: true }).waitFor();
      await page.setViewportSize({ width: 390, height: 844 }); await page.evaluate(() => document.fonts.ready);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(out, 'author-mobile.png'), fullPage: false });
    });
  } finally { await writeFile(pageFile, originalPage); await writeFile(apiFile, originalApi); await writeFile(configPath, config); }
  assert.deepEqual(errors, []); await record({ label: 'source-hmr-node-reload-disable-enable', browser: browser.version(), pageErrors: errors.length });
  await pm('author-app-build',author,['build:app']);
  const goodOutput=await filesUnder(join(author,'app-dist'));
  const missingAsset=join(author,'src/assets/plugin-mark.svg'),assetBytes=await readFile(missingAsset);
  try {await rm(missingAsset);await pm('missing-plugin-asset-rejects-app-build',author,['build:app'],1);
    assert.deepEqual(await filesUnder(join(author,'app-dist')),goodOutput,'Failed asset build changed the last published application');
  } finally {await writeFile(missingAsset,assetBytes);}
  await pm('repaired-plugin-asset-build',author,['build:app']);
  const diagnosis = parseEvents(await installedCli(author, 'diagnose')).find(e => e.type === 'result')!.data;
  assert.ok(diagnosis.healthy); assert.ok(diagnosis.contributions.some((s: any) => s.id === 'dev-api' && s.records.length));
  // Stale development output must never enter an archive compiled from a fresh source snapshot.
  await writeFile(join(author, 'dist/stale.js'), 'STALE_PACKAGE_MARKER');
  const licenseFixture = 'License preservation fixture only; not a license selection or grant.\n';
  await writeFile(join(author, 'LICENSE.md'), licenseFixture);
  const packedOutput = await pm('plugin-pack', author, ['pack:plugin']);
  const archive = parseEvents(packedOutput).find((e: any) => typeof e.file === 'string') as any; assert.ok(archive?.file);
  const listing = (await checked('tar', ['-tzf', archive.file], temporary)).trim().split('\n');
  for (const entry of listing) { const p = packagePath(entry.replace(/\/$/, '')); assert.ok(p === 'package' || p.startsWith('package/')); }
  assert.ok(listing.every(p => !/stale|\.cormi-local|playground|scripts|tsconfig/.test(p)));
  const unpacked = join(temporary, 'unpacked'); await mkdir(unpacked); await checked('tar', ['-xzf', archive.file, '-C', unpacked], temporary);
  const files = await filesUnder(join(unpacked, 'package')), manifest = JSON.parse(files.get('package.json')!.toString());
  assert.equal(manifest.name, name); assert.equal(manifest.private, true);
  assert.deepEqual(manifest.sideEffects,['**/*.css']);
  for(const [path,bytes] of assetFixture.files) {assert.deepEqual(files.get(path),bytes);assert.deepEqual(files.get('dist/'+path.slice(4)),bytes);}
  assert.equal(files.has('dist/assets/removed.svg'),false);
  if(assetFixture.font)assert.deepEqual(files.get('NOTICE.md'),await readFile(join(author,'NOTICE.md')));
  assert.equal(files.get('LICENSE.md')?.toString(), licenseFixture);
  assert.equal(files.get('README.md')?.toString(), await readFile(join(author, 'PACKAGE.md'), 'utf8'));
  for (const key of ['scripts','devDependencies','pnpm']) assert.equal(manifest[key], undefined);
  assert.doesNotMatch(JSON.stringify(manifest), /file:|link:|workspace:|\.cormi-local/);
  for (const exp of Object.values(manifest.exports) as Array<{types:string;import:string}>) { assert.ok(files.has(exp.types.slice(2)) && files.has(exp.import.slice(2))); }
  for (const [path, bytes] of files) if (path.endsWith('.map')) {
    const data = JSON.parse(bytes.toString()); for (const source of data.sources) assert.ok(files.has(packagePath(posix.normalize(posix.join(posix.dirname(path), source)))));
  }
  await record({ label: 'archive-exports-maps-clean-boundary', files: files.size, sha256: sha256(await readFile(archive.file)) });
  const archiveDirs = (await readdir(join(author, 'artifacts'))).sort();
  await writeFile(join(author, 'src/.env'), 'PRIVATE_SHOULD_NOT_PACK'); await pm('pack-rejects-private', author, ['pack:plugin'], 1); await rm(join(author, 'src/.env'));
  await symlink(apiFile, join(author, 'src/linked.ts')); await pm('pack-rejects-link', author, ['pack:plugin'], 1); await rm(join(author, 'src/linked.ts'));
  await writeFile(join(author, 'src/broken.ts'), 'export const wrong: number = "bad";'); await pm('pack-rejects-types', author, ['pack:plugin'], 1); await rm(join(author, 'src/broken.ts'));
  assert.deepEqual((await readdir(join(author, 'artifacts'))).sort(), archiveDirs);
  await execute('create-consumer', creator, process.execPath, [bin, consumer, '--kit', kitPath, '--template', 'react', '--json']);
  const p = await json(join(consumer, 'package.json')); p.dependencies[name] = 'file:./.cormi-local/author.tgz';
  for (const dependency of ['@cormijs/core','@cormijs/plugin-react','@cormijs/plugin-dev-api','@cormijs/plugin-vite']) p.dependencies[dependency] = p.pnpm.overrides[dependency];
  await writeFile(join(consumer, '.cormi-local/author.tgz'), await readFile(archive.file)); await writeFile(join(consumer, 'package.json'), JSON.stringify(p, null, 2));
  await writeFile(join(consumer, 'cormi.config.ts'), `import {defineConfig} from 'cormijs';import preset from '@cormijs/preset-react-vite';import {devApiVitePlugin} from '@cormijs/plugin-dev-api/vite';import feature from ${JSON.stringify(name)};
export default defineConfig(({command})=>({presets:[preset],plugins:[{id:'api',plugin:devApiVitePlugin,options:{prefix:'/customer/api'},enabled:command==='dev'},{id:'feature',plugin:feature,options:{development:command==='dev',label:'independent consumer',apiBase:'/customer/api'}}],app:{base:'/customer/',server:{host:'127.0.0.1',port:${await freePort()}}}}));\n`);
  await pm('consumer-install', consumer, ['install','--offline','--ignore-scripts','--no-frozen-lockfile']); await auditLinks(consumer);
  const lock = await readFile(join(consumer, 'pnpm-lock.yaml'));
  const relocated = join(temporary, 'author relocated 中文'); await rename(author, relocated); await rename(kitPath, join(temporary, 'kit relocated'));
  await rm(join(consumer, 'node_modules'), { recursive: true }); await pm('consumer-relocated-reinstall', consumer, ['install','--offline','--ignore-scripts','--frozen-lockfile']);
  assert.deepEqual(await readFile(join(consumer, 'pnpm-lock.yaml')), lock); await auditLinks(consumer);
  await installedCli(consumer, 'typecheck'); await installedCli(consumer, 'diagnose');
  await writeFile(join(consumer, 'plugin-types.mts'), `import feature, {type Options} from ${JSON.stringify(name)}; import api from ${JSON.stringify(name + '/api')}; import runtime from ${JSON.stringify(name + '/client')}; import Page from ${JSON.stringify(name + '/page')};\nconst options: Options = {development:true,label:'test',apiBase:'/api'}; void [feature,api,runtime,Page,options];\n// @ts-expect-error invalid public plugin options must remain a type error\nconst invalid: Options = {development:'yes',label:'x',apiBase:'/api'};\n`);
  await execute('consumer-strict-plugin-types', consumer, process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '--noEmit', '--target', 'ES2023', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--strict', '--skipLibCheck', 'false', 'plugin-types.mts']);
  await server(consumer, 'dev', async url => { await pageBasics(page, url, 'independent consumer', true); await record({label:'installed-package-dev-assets',...(await verifyPluginAssets(page,url,assetFixture))}); });
  await installedCli(consumer, 'build'); await installedCli(consumer, 'build');
  for (const [file, bytes] of await filesUnder(join(consumer, 'dist'))) if (/\.(?:js|css|html)$/.test(file)) assert.doesNotMatch(bytes.toString(), /cormi-plugin-template|Expected plugin options|devApi\.add/);
  await server(consumer, 'preview', async url => { await pageBasics(page, url, 'independent consumer', false);
    await record({label:'installed-package-preview-assets',...(await verifyPluginAssets(page,url,assetFixture))});
    const response = await fetch(new URL('api/hello', url)); assert.doesNotMatch(await response.text(), /Hello, independent consumer/);
    await page.screenshot({ path: join(out, 'consumer-production.png'), fullPage: false });
  });
  assert.deepEqual(errors, []);
  await record({ label: 'relocated-tgz-consumer-types-diagnosis-dev-rebuild-preview', sourceFallback: false, lockUnchanged: true, pageErrors: 0 });
  // Rebuild the installed package at the origin root as well; no source alias or resource mirror is installed.
  const customerConfig=await readFile(join(consumer,'cormi.config.ts'),'utf8');
  await writeFile(join(consumer,'cormi.config.ts'),customerConfig.replace("base:'/customer/'","base:'/'").replaceAll('/customer/api','/api'));
  await server(consumer,'dev',async url=>{await pageBasics(page,url,'independent consumer',true);await record({label:'installed-package-root-dev-assets',...(await verifyPluginAssets(page,url,assetFixture))});});
  await installedCli(consumer,'build');
  await server(consumer,'preview',async url=>{await pageBasics(page,url,'independent consumer',false);await record({label:'installed-package-root-preview-assets',...(await verifyPluginAssets(page,url,assetFixture))});});
  await writeFile(join(consumer,'cormi.config.ts'),customerConfig);
  await installedCli(consumer,'build');
  assert.deepEqual(errors,[]);
  await verifyPluginInstances({ consumer, name, page, out, port: await freePort(), record,
    cli: (command, args, expected) => installedCli(consumer, command, args, expected),
    server: (command, action) => server(consumer, command, action),
  });
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  await browser?.close(); await writeFile(join(out, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, stages: report.stages.length, result: join(out, 'result.json'), error: report.error }));
  // Independent source/consumer trees remain available for evidence and explicit local trial; no services remain.
}
