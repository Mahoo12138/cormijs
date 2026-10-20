import test from 'node:test';
import assert from 'node:assert/strict';
import { applyHtmlHead, normalizeScript, type HtmlPluginOptions } from '@cormijs/plugin-react-vite';

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

test('headScripts and scripts follow Umi ordering with escaped attributes and breakout-safe content', () => {
  const result = applyHtmlHead(source, {
    links: [{ rel: 'canonical', href: '/page' }],
    headScripts: ['/html/mark.js', 'document.head = 1', { content: 'document.head = 2', async: true, type: 'text/plain', charset: 'utf-8', crossorigin: 'anonymous' },
      { src: 'https://cdn.example/a.js', defer: true }],
    scripts: [{ content: 'const closing = "</script><img src=x onerror=alert(1)>"; document.body.append(closing);' }],
  });
  assert.ok(result.indexOf('rel="canonical"') < result.indexOf('/html/mark.js'), 'head scripts come after links');
  assert.match(result, /<script src="\/html\/mark\.js"><\/script>/);
  assert.match(result, /<script>document\.head = 1<\/script>/);
  assert.match(result, /<script charset="utf-8" type="text\/plain" crossorigin="anonymous" async>document\.head = 2<\/script>/);
  assert.match(result, /<script src="https:\/\/cdn\.example\/a\.js" defer><\/script>/);
  assert.match(result, /<script>const closing = "\\x3c\/script><img src=x onerror=alert\(1\)>"; document\.body\.append\(closing\);<\/script>\s*<\/body>/);
  assert.ok(!result.includes('</script><img'), 'inline content cannot close its own tag');
  assert.equal((result.match(/<script/g) ?? []).length, 5);
});

test('options supplied by the runtime stay unmutated while scripts are normalized', () => {
  const frozen = Object.freeze({ headScripts: Object.freeze([Object.freeze('/a.js')]), scripts: Object.freeze([Object.freeze({ content: 'x = 1' })]) });
  const result = applyHtmlHead(source, frozen);
  assert.match(result, /<script src="\/a\.js"><\/script>/);
  assert.match(result, /<script>x = 1<\/script>/);
  assert.equal((frozen.headScripts as readonly unknown[]).length, 1);
});

test('script entries are validated against a closed attribute set', () => {
  const invalid: readonly unknown[] = [
    { headScripts: [{ src: '/a.js', content: 'x' }] },
    { headScripts: [{}] },
    { headScripts: [{ src: '/a.js', innerHTML: 'x' }] },
    { headScripts: [{ src: '/a.js', async: 'yes' }] },
    { headScripts: ['\u0000'] },
    { scripts: [{ content: 'x'.repeat(20000) }] },
    { scripts: [{}] },
  ];
  for (const options of invalid) assert.throws(() => applyHtmlHead(source, options as HtmlPluginOptions), (error: any) => error?.code === 'HTML_INVALID', JSON.stringify(options));
  assert.throws(() => applyHtmlHead('<html><head><title>t</title></head></html>', { scripts: ['document.x = 1'] }),
    (error: any) => error?.code === 'HTML_INVALID');
  assert.deepEqual(normalizeScript('/a.js'), { src: '/a.js' });
  assert.deepEqual(normalizeScript('globalThis.x = 1'), { content: 'globalThis.x = 1' });
});
