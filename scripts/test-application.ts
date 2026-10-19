import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, lstat, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium, type Browser, type Page } from 'playwright-core';
import { packWorkspace, run, sha256, consumerNpmrc } from './packaging.js';
import { siteFiles, siteMime, serveStaticCopy } from './application-static.js';
import { assertPortFree } from '../tests/helpers.js';

// Flow: installed creator -> app + native feature -> environment/Mock -> checks/build -> copied static site.
// The Browser skill/runtime is not supplied; use the repository's isolated Playwright workflow.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ strict: true, options: { out: { type: 'string' }, keep: { type: 'boolean' } } });
await mkdir(join(root, '.cache'), { recursive: true });
const out = resolve(values.out ?? join(root, '.cache', 'application-test-' + Date.now())); await mkdir(out);
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'cormi application 中文 ')));
const kitPath = join(temporary, 'kit'), creator = join(temporary, 'creator');
let app = join(temporary, 'app'), browser: Browser | undefined;
const report: { format: string; passed: boolean; temporary: string; application?: string; stages: Array<Record<string, unknown>>; error?: string } = {
  format: 'cormi:application-test:1', passed: false, temporary, stages: [],
};
const env: NodeJS.ProcessEnv = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', CI: 'true',
  npm_config_store_dir: join(root, '.cache/pnpm-store'), npm_config_cache_dir: join(root, '.cache/pnpm-cache'),
  npm_config_state_dir: join(temporary, 'state'), npm_config_ignore_scripts: 'true', npm_config_package_import_method: 'copy',
  npm_config_userconfig: join(temporary, 'empty.npmrc'), npm_config_globalconfig: join(temporary, 'empty-global.npmrc') };
await writeFile(env.npm_config_userconfig!, ''); await writeFile(env.npm_config_globalconfig!, '');
async function record(data: Record<string, unknown>) { report.stages.push(data); await writeFile(join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n'); }
async function execute(label: string, cwd: string, executable: string, args: string[], expected = 0) {
  const result = await run(executable, args, cwd, env, 120000), text = result.stdout + result.stderr;
  const log = label + '-' + report.stages.length + '.log'; await writeFile(join(out, log), text);
  assert.equal(result.code, expected, `${label}\n${text}`); await record({ label, code: result.code, expected, log, sha256: sha256(text) });
  return result.stdout;
}
const pm = (label: string, cwd: string, args: string[], expected = 0) => execute(label, cwd, 'pnpm', args, expected);
const command = (label: string, name: string, expected = 0, extra: string[] = []) => execute(label, app, process.execPath,
  [join(app, 'node_modules/cormijs/dist/cli.js'), name, '--mode', 'staging', '--json', '--startup-timeout', '30000', ...extra], expected);
function events(text: string): Array<Record<string, any>> { return text.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }); }
const digest = async (directory: string) => Object.fromEntries([...(await siteFiles(directory))].map(([path, bytes]) => [path, sha256(bytes)]));
async function auditLinks() {
  let links = 0;
  async function visit(dir: string): Promise<void> { for (const name of await readdir(dir)) {
    const path = join(dir, name), info = await lstat(path);
    if (info.isSymbolicLink()) { assert.ok((await realpath(path)).startsWith(app + sep), 'Install link escapes application'); links++; }
    else if (info.isDirectory()) await visit(path);
  } }
  await visit(join(app, 'node_modules')); await record({ label: 'independent-installation', links, workspaceLinks: 0 });
}
let sequence = 0;
async function withServer(kind: 'dev' | 'preview', action: (url: string) => Promise<void>) {
  const child = fork(join(app, 'node_modules/cormijs/dist/cli.js'), [kind, '--mode', 'staging', '--json', '--startup-timeout', '30000'],
    { cwd: app, env, execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let output = '', stderr = '', processError: Error | undefined, ended = false;
  const done = new Promise<number | null>(resolveDone => { child.once('error', error => { processError = error; }); child.once('close', code => { ended = true; resolveDone(code); }); });
  child.stdout!.on('data', chunk => { output += String(chunk); }); child.stderr!.on('data', chunk => { stderr += String(chunk); });
  let url: string | undefined;
  try {
    const end = Date.now() + 35000;
    while (!url) {
      if (processError) throw processError;
      const messages = events(output), failure = messages.find(e => e.type === 'error'); if (failure) throw new Error(JSON.stringify(failure));
      url = messages.find(e => e.type === 'ready')?.url;
      if (!url) { assert.ok(!ended && Date.now() < end, output + stderr); await delay(20); }
    }
    await action(url);
  } finally {
    if (child.connected) child.send({ version: 1, type: 'cormi:shutdown' }, () => {});
    const timer = setTimeout(() => { if (!ended) child.kill('SIGKILL'); }, 10000);
    try { assert.equal(await done, 0, output + stderr); }
    finally { clearTimeout(timer); await writeFile(join(out, `${kind}-${++sequence}.log`), output + stderr); }
    assert.equal(existsSync(join(app, '.cormi.lock')), false); if (url) await assertPortFree(Number(new URL(url).port));
    await record({ label: kind + '-session-closed', starts: events(output).filter(e => e.type === 'starting').length });
  }
}
async function home(page: Page, url: string, dev: boolean) {
  await page.goto(url); assert.equal(page.url(), url); assert.equal(await page.title(), 'cormi app');
  await page.getByRole('heading', { name: 'cormi MVP staging', exact: true }).waitFor();
  assert.equal(await page.locator('cormi-development-overlay,vite-error-overlay').count(), 0);
  await page.getByRole('button', { name: 'Count: 0', exact: true }).click(); await page.getByRole('button', { name: 'Count: 1', exact: true }).waitFor();
  const button = page.getByRole('button', { name: '请求 Mock', exact: true }); assert.equal(await button.isEnabled(), dev);
  if (dev) { await button.click(); await page.locator('output').filter({ hasText: 'Hello, cormi!' }).waitFor(); }
}
try {
  const kit = await packWorkspace(root, kitPath); await record({ label: 'actual-archives', count: kit.packages.length });
  await mkdir(creator); await writeFile(join(creator, '.npmrc'), consumerNpmrc);
  await writeFile(join(creator, 'package.json'), JSON.stringify({ name: 'cormi-local-creator', private: true, type: 'module',
    dependencies: { '@cormijs/create': 'file:' + join(kitPath, kit.packages.find(p => p.name === '@cormijs/create')!.file) } }));
  await pm('install-creator', creator, ['install', '--offline', '--ignore-scripts', '--no-frozen-lockfile']);
  await execute('create-application', creator, join(creator, 'node_modules/.bin/create-cormi'), [app, '--kit', kitPath, '--template', 'react-api', '--name', 'cormi-mvp', '--json']);
  const manifestPath = join(app, 'package.json'), manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.dependencies['@cormijs/plugin-react'] = manifest.pnpm.overrides['@cormijs/plugin-react'];
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  const additions: Record<string, string> = {
    '.env.staging': 'CORMI_PUBLIC_TITLE=cormi MVP staging\nCORMI_PRIVATE_TOKEN=P12_PRIVATE_SENTINEL\n',
    'src/pages/_layout.tsx': `import {Link,Outlet} from 'react-router';export default function Layout(){return <><nav aria-label="应用导航"><Link to="/">首页</Link> | <Link to="/status">插件页面</Link> | <Link to="/users/42">用户详情</Link></nav><Outlet/></>}`,
    'src/pages/users/[id].tsx': `import {useParams} from 'react-router';export default function User(){return <main><h1>User {useParams().id}</h1></main>}`,
    'features/status/plugin.ts': `import {defineReactFeature,clientModule} from '@cormijs/plugin-react';export default (label:string)=>defineReactFeature({id:'guide:status',routes:[{id:'guide:status:page',path:'status',module:clientModule('./Page.tsx',import.meta.url)}],runtime:[{id:'guide:status:runtime',module:clientModule('./runtime.ts',import.meta.url),options:{label}}]});`,
    'features/status/runtime.ts': `import type {RuntimePlugin} from '@cormijs/runtime';const plugin:RuntimePlugin={setup({options}){document.documentElement.dataset.guideLabel=(options as {label:string}).label;return ()=>{delete document.documentElement.dataset.guideLabel}}};export default plugin;`,
    'features/status/Page.tsx': `import {Link} from 'react-router';import styles from './status.module.css';import mark from './mark.svg';export default function Status(){return <main className={styles.card}><h1>插件页面</h1><p>{import.meta.env.CORMI_PUBLIC_TITLE}</p><p id="runtime-label">{document.documentElement.dataset.guideLabel}</p><img src={mark} width={48} height={48} alt="状态图标"/><p><Link to="/">回到首页</Link></p></main>}`,
    'features/status/status.module.css': '.card{border:3px solid currentColor;padding:24px} ',
    'features/status/mark.svg': '<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><circle cx="24" cy="24" r="18" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
  };
  for (const [path, text] of Object.entries(additions)) { await mkdir(dirname(join(app, path)), { recursive: true }); await writeFile(join(app, path), text, { flag: 'wx' }); }
  const originalConfig = await readFile(join(app, 'cormi.config.ts'), 'utf8');
  assert.ok(originalConfig.includes("const base = '/';") && originalConfig.includes('plugins: ['));
  const configuration = originalConfig.replace("const base = '/';", "import statusFeature from './features/status/plugin';\nconst base = '/';")
    .replace('({ command })', '({ command, env })').replace('port: 8000', 'port: 0')
    .replace('plugins: [', "plugins: [{ id: 'status', plugin: statusFeature(env.CORMI_PUBLIC_TITLE ?? 'cormi') }, ");
  await writeFile(join(app, 'cormi.config.ts'), configuration);
  const tsconfigPath = join(app, 'tsconfig.json'), tsconfig = JSON.parse(await readFile(tsconfigPath, 'utf8')); tsconfig.include.push('features');
  await writeFile(tsconfigPath, JSON.stringify(tsconfig, null, 2));
  await pm('install-app', app, ['install', '--offline', '--ignore-scripts', '--no-frozen-lockfile']); await auditLinks();
  const lock = await readFile(join(app, 'pnpm-lock.yaml')); const oldApp = app; app = join(temporary, 'relocated app 中文'); await rename(oldApp, app);
  await rename(kitPath, join(temporary, 'moved-kit')); await rm(join(app, 'node_modules'), { recursive: true });
  await pm('relocated-frozen-install', app, ['install', '--offline', '--ignore-scripts', '--frozen-lockfile']);
  assert.deepEqual(await readFile(join(app, 'pnpm-lock.yaml')), lock); await auditLinks(); report.application = app;
  await pm('prepare-script', app, ['run', 'prepare:app', '--mode', 'staging']);
  await pm('typecheck-script', app, ['typecheck', '--mode', 'staging']);
  await pm('config-script', app, ['run', 'config:app', '--for', 'build', '--mode', 'staging', '--json']);
  browser = await chromium.launch({ executablePath: process.env.CORMI_BROWSER ?? '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(15000);
  const errors: string[] = []; page.on('pageerror', error => errors.push(String(error))); page.on('console', message => { if (['error', 'warning'].includes(message.type())) errors.push(message.text()); });
  for (const base of ['/', '/workbench/']) {
    const tag = base === '/' ? 'root' : 'subpath';
    await writeFile(join(app, 'cormi.config.ts'), configuration.replace("const base = '/';", `const base = '${base}';`));
    await withServer('dev', async url => {
      assert.equal(new URL(url).pathname, base);
      const apiRequests: string[] = []; const watch = (request: import('playwright-core').Request) => { if (request.url().includes('/api/hello')) apiRequests.push(new URL(request.url()).pathname); }; page.on('request', watch);
      await home(page, url, true); assert.deepEqual(apiRequests, [base + 'api/hello']); page.off('request', watch);
      const origin = new URL(url).origin;
      if (base !== '/') assert.equal((await fetch(origin + '/api/hello')).status, 404);
      await page.getByRole('link', { name: '插件页面', exact: true }).click(); await page.getByRole('heading', { name: '插件页面', exact: true }).waitFor();
      assert.equal(page.url(), new URL('status', url).href); assert.equal(await page.locator('#runtime-label').innerText(), 'cormi MVP staging');
      assert.equal(await page.locator('main').evaluate(e => getComputedStyle(e).borderTopWidth), '3px');
      await page.getByAltText('状态图标').evaluate((e: HTMLImageElement) => e.decode());
      for (const path of ['.env.staging?raw', 'features/status/plugin.ts?raw']) assert.equal((await fetch(new URL(path, url))).status, 403);
      await record({ label: tag + '-dev-plugin-environment-and-mock', apiRequests, runtime: true });
    });
    await command(tag + '-typecheck', 'typecheck'); await command(tag + '-build', 'build'); await command(tag + '-rebuild', 'build');
    const distBefore = await digest(join(app, 'dist')), generatedBefore = await digest(join(app, '.cormi'));
    for (const cmd of ['config', 'diagnose', 'inspect']) {
      const output = await command(tag + '-' + cmd, cmd, 0, cmd === 'inspect' ? [] : ['--for', 'build']);
      assert.doesNotMatch(output, /P12_PRIVATE_SENTINEL/);
    }
    assert.deepEqual(await digest(join(app, 'dist')), distBefore); assert.deepEqual(await digest(join(app, '.cormi')), generatedBefore);
    await writeFile(join(app, 'src/type-failure.ts'), "const value: number = 'invalid'; export { value };", { flag: 'wx' });
    assert.match(await command(tag + '-expected-type-error', 'typecheck', 1), /TYPECHECK_FAILED/); await rm(join(app, 'src/type-failure.ts'));
    await writeFile(join(app, 'src/pages/status.tsx'), 'export default function Conflict(){return null}', { flag: 'wx' });
    assert.match(await command(tag + '-expected-route-conflict', 'build', 1), /ROUTE_/); await rm(join(app, 'src/pages/status.tsx'));
    assert.deepEqual(await digest(join(app, 'dist')), distBefore); await command(tag + '-recovered-types', 'typecheck');
    await withServer('preview', async url => { await home(page, url, false); });
    const site = join(temporary, 'site-' + tag); await mkdir(site);
    const publishable = [...(await siteFiles(join(app, 'dist')))].filter(([name]) => !name.split('/').some(part => part.startsWith('.')));
    for (const [name, bytes] of publishable) {
      assert.equal(bytes.includes(Buffer.from('P12_PRIVATE_SENTINEL')), false, name);
      await mkdir(dirname(join(site, name)), { recursive: true }); await writeFile(join(site, name), bytes, { flag: 'wx' });
    }
    const away = app + '-unavailable'; await rename(app, away); assert.equal(existsSync(app), false);
    const host = await serveStaticCopy(site, base);
    try {
      await home(page, host.url, false);
      await page.goto(new URL('status', host.url).href); await page.getByRole('heading', { name: '插件页面', exact: true }).waitFor();
      await page.reload(); await page.getByAltText('状态图标').evaluate((e: HTMLImageElement) => e.decode());
      assert.equal(await page.locator('#runtime-label').innerText(), 'cormi MVP staging');
      assert.equal(await page.locator('main').evaluate(e => getComputedStyle(e).borderTopWidth), '3px');
      await page.getByRole('link', { name: '回到首页', exact: true }).click(); await page.getByRole('heading', { name: 'cormi MVP staging', exact: true }).waitFor();
      await page.getByRole('link', { name: '用户详情', exact: true }).click(); await page.getByRole('heading', { name: 'User 42', exact: true }).waitFor();
      await page.reload(); await page.getByRole('heading', { name: 'User 42', exact: true }).waitFor();
      for (const [name, bytes] of publishable) {
        const response = await fetch(new URL(name, host.url)); assert.equal(response.status, 200, name);
        assert.equal(response.headers.get('content-type'), siteMime[extname(name)] ?? 'application/octet-stream', name);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes, name);
      }
      for (const path of ['assets/missing.js', 'api/hello', '.env.staging', '.cormi-build.json', '.cormi/app.tsx']) assert.equal((await fetch(new URL(path, host.url), { headers: { accept: 'text/html' } })).status, 404, path);
      await page.setViewportSize({ width: 390, height: 844 }); await home(page, host.url, false);
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.screenshot({ path: join(out, tag + '-static.png'), fullPage: false }); await page.setViewportSize({ width: 1280, height: 800 });
      assert.deepEqual(errors, []);
      await record({ label: tag + '-standalone-static', files: publishable.length, sourceUnavailable: true, cormiServer: false, requests: host.requests });
    } finally { await host.close(); await assertPortFree(Number(new URL(host.url).port)); await rename(away, app); }
    assert.deepEqual(await digest(join(app, 'dist')), distBefore);
  }
  await pm('final-frozen-install', app, ['install', '--offline', '--ignore-scripts', '--frozen-lockfile']);
  assert.deepEqual(await readFile(join(app, 'pnpm-lock.yaml')), lock); report.passed = true;
} catch (error) { report.error = String(error); process.exitCode = 1; }
finally {
  await browser?.close();
  await writeFile(join(out, 'result.json'), JSON.stringify(report, null, 2) + '\n');
  if (report.passed && !values.keep) await rm(temporary, { recursive: true, force: true });
  console.log(JSON.stringify({ passed: report.passed, stages: report.stages.length, out, application: report.application, retained: !report.passed || !!values.keep, error: report.error }));
}
