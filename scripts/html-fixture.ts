import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import type { Page } from 'playwright-core';

export const htmlConfiguration = `import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import { htmlPlugin } from '@cormijs/plugin-react-vite';
export default defineConfig({
  presets: [preset],
  plugins: [{
    id: 'html', plugin: htmlPlugin,
    options: {
      title: 'Configured title',
      lang: 'zh-CN',
      favicon: '/html/favicon.svg',
      metas: [
        { name: 'description', content: 'Cormi HTML head' },
        { property: 'og:title', content: 'Configured <title>' },
      ],
      links: [{ rel: 'canonical', href: '/html/' }],
      headScripts: [{ src: '/html/mark.js', defer: true }, 'window.__cormiHead = "inline-head"'],
      scripts: [{ content: 'window.__cormiBody = "inline-body"', async: true }],
    },
  }],
  app: { base: '/html/', server: { port: 0 } },
});
`;

export async function writeHtmlFixture(root: string) {
  await mkdir(join(root, 'src/pages'), { recursive: true });
  await mkdir(join(root, 'public'), { recursive: true });
  const files: Record<string, string> = {
    'index.html': '<!doctype html><html lang="en"><head><meta charset="UTF-8"><title>Original title</title></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
    'cormi.config.ts': htmlConfiguration,
    'public/mark.js': 'window.__cormiMark = "external-mark";',
    'public/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="7" fill="#35617a"/></svg>',
    'src/pages/index.tsx': 'export default function Home(){return <main><h1>HTML head home</h1></main>;}',
    'tsconfig.json': JSON.stringify({ compilerOptions: { target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      strict: true, noEmit: true, skipLibCheck: false, allowImportingTsExtensions: true, lib: ['ES2023', 'DOM', 'DOM.Iterable'], types: ['react', 'react-dom', 'node'] },
      include: ['cormi.config.ts', 'src', '.cormi/**/*'] }, null, 2),
  };
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
}

export async function verifyHtmlPage(page: Page, url: string) {
  await page.goto(url); await page.getByRole('heading', { name: 'HTML head home', exact: true }).waitFor();
  assert.equal(await page.title(), 'Configured title');
  assert.equal(await page.locator('html').getAttribute('lang'), 'zh-CN');
  assert.equal(await page.locator('meta[name="description"]').getAttribute('content'), 'Cormi HTML head');
  assert.equal(await page.locator('meta[property="og:title"]').getAttribute('content'), 'Configured <title>');
  assert.equal(new URL(await page.locator('link[rel="icon"]').getAttribute('href') ?? '', url).pathname, '/html/favicon.svg');
  assert.equal(new URL(await page.locator('link[rel="canonical"]').getAttribute('href') ?? '', url).pathname, '/html/');
  assert.equal(await page.locator('title').count(), 1);
  assert.equal(await page.evaluate('window.__cormiHead'), 'inline-head');
  assert.equal(await page.evaluate('window.__cormiMark'), 'external-mark');
  assert.equal(await page.evaluate('window.__cormiBody'), 'inline-body');
  assert.equal(await page.evaluate('document.querySelectorAll(\'script[src="/html/mark.js"][defer]\').length'), 1);
  assert.equal(await page.evaluate('const headScript = document.querySelectorAll(\'script[src="/html/mark.js"]\')[0]; !!(headScript.compareDocumentPosition(document.getElementById("root")) & Node.DOCUMENT_POSITION_FOLLOWING)'), true);
  assert.equal(await page.locator('vite-error-overlay, cormi-development-overlay').count(), 0);
}
