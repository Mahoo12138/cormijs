import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHtmlHead } from '@cormijs/plugin-react-vite';

const source = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Old</title></head><body><div id="root"></div></body></html>';
test('HTML head options replace title, lang and append escaped meta/link/favicon tags', () => {
  const result = applyHtmlHead(source, {
    title: 'New <title> & more', lang: 'zh-CN', favicon: '/favicon.svg?x=1&y=2',
    metas: [{ name: 'description', content: 'A "quoted" <meta>' }, { property: 'og:title', content: 'Cormi' }],
    links: [{ rel: 'canonical', href: '/page?a=1&b=2' }],
  });
  assert.match(result, /<html lang="zh-CN">/);
  assert.match(result, /<title>New &lt;title&gt; &amp; more<\/title>/);
  assert.match(result, /<link rel="icon" href="\/favicon\.svg\?x=1&amp;y=2" \/>/);
  assert.match(result, /<meta name="description" content="A &quot;quoted&quot; &lt;meta&gt;" \/>/);
  assert.match(result, /<meta property="og:title" content="Cormi" \/>/);
  assert.match(result, /<link rel="canonical" href="\/page\?a=1&amp;b=2" \/>/);
  assert.equal((result.match(/<title>/g) ?? []).length, 1);
  assert.throws(() => applyHtmlHead('<html><body></body></html>', { title: 'x' }), (error: any) => error?.code === 'HTML_INVALID');
  assert.throws(() => applyHtmlHead(source, { metas: [{ content: 'x' }] } as never), (error: any) => error?.code === 'HTML_INVALID');
  assert.throws(() => applyHtmlHead(source, { metas: [{ name: 'x', property: 'y', content: 'z' }] }), (error: any) => error?.code === 'HTML_INVALID');
  assert.throws(() => applyHtmlHead(source, { links: [{ rel: 'x' }] } as never), (error: any) => error?.code === 'HTML_INVALID');
});
