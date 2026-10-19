import assert from 'node:assert/strict';
import { lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from 'playwright-core';
import { sha256 } from './packaging.js';

export interface PluginAssetFixture { readonly files: ReadonlyMap<string, Buffer>; readonly font: boolean }
/** Synthetic image fixtures and, when explicitly supplied, an installed font plus its original notice. */
export async function preparePluginAssets(author: string, fontRoot?: string): Promise<PluginAssetFixture> {
  const files=new Map<string,Buffer>();
  const original=await readFile(join(author,'src/assets/plugin-mark.svg'),'utf8');
  const large=original.replace('</svg>','<desc>'+ 'Resource relocation fixture. '.repeat(250)+'</desc></svg>');
  files.set('src/assets/图示 space.svg',Buffer.from(large));
  // A one-pixel PNG, not downloaded or derived from a third-party image.
  files.set('src/assets/pixel.png',Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010804000000b51c0c020000000b4944415478da6364f80f00010501012718e3660000000049454e44ae426082','hex'));
  let notice: Buffer | undefined;
  if(fontRoot) {
    const folder=await realpath(fontRoot),manifest=JSON.parse(await readFile(join(folder,'package.json'),'utf8'));
    assert.equal(manifest.name,'@fontsource-variable/dm-sans');assert.equal(manifest.version,'5.2.5');
    const path=join(folder,'files/dm-sans-latin-wght-normal.woff2');assert.ok((await lstat(path)).isFile());
    const bytes=await readFile(path);assert.ok(bytes.length>4096&&bytes.length<1024*1024);
    notice=await readFile(join(folder,'LICENSE'));
    files.set('src/assets/validation-font.woff2',bytes);
    files.set('src/assets/fixture-font.css',Buffer.from('@font-face { font-family: "Cormi Fixture Sans"; src: url("./validation-font.woff2") format("woff2"); font-weight: 100 1000; font-style: normal; font-display: swap; }\nmain h1 { font-family: "Cormi Fixture Sans", sans-serif; }\n'));
  }
  for(const [path,bytes] of files) await writeFile(join(author,path),bytes,{flag:'wx'});
  if(notice) await writeFile(join(author,'NOTICE.md'),notice,{flag:'wx'});
  const page=join(author,'src/page.tsx');
  await writeFile(page,(await readFile(page,'utf8')).replace("import illustration from", "import unicodeAsset from './assets/图示 space.svg';\nimport pngAsset from './assets/pixel.png';\nimport illustration from")
    .replace('<h1>插件开发示例</h1>', '<img src={unicodeAsset} data-testid="unicode-asset" width={24} height={24} alt="重定位资源" /><img src={pngAsset} data-testid="binary-asset" width={16} height={16} alt="二进制资源" /><h1>插件开发示例</h1>'));
  if(fontRoot) {const css=join(author,'src/page.module.css');await writeFile(css,"@import './assets/fixture-font.css';\n"+await readFile(css,'utf8'));}
  for(const path of ['src/page.module.css','src/assets/tokens.css','src/assets/plugin-mark.svg','src/assets.d.ts']) files.set(path,await readFile(join(author,path)));
  return {files,font:!!fontRoot};
}

/** Check actual computed CSS, decoded images, request MIME/bytes and the current deployment prefix. */
export async function verifyPluginAssets(page: Page, base: string, fixture: PluginAssetFixture) {
  const expectedBase=new URL(base);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('main')!).borderTopWidth==='2px');
  const style=await page.locator('main').evaluate(element=>({className:element.className,border:getComputedStyle(element).borderTopWidth,radius:getComputedStyle(element).borderRadius,background:getComputedStyle(element).backgroundImage}));
  assert.ok(style.className && style.className!=='panel');assert.equal(style.radius,'12px');assert.notEqual(style.background,'none');
  async function checkUrl(url: string, mime: RegExp, bytes?: Buffer) {
    if(!url.startsWith('data:')) {const u=new URL(url,base);assert.equal(u.origin,expectedBase.origin);assert.ok(u.pathname.startsWith(expectedBase.pathname),'Resource escaped base: '+u.href);}
    let body: Buffer;
    if(url.startsWith('data:')) {
      const response=await page.evaluate(async value=>{const r=await fetch(value);return {status:r.status,type:r.headers.get('content-type'),bytes:Array.from(new Uint8Array(await r.arrayBuffer()))};},url);
      assert.equal(response.status,200);assert.match(response.type??'',mime);body=Buffer.from(response.bytes);
    } else {
      const response=await page.request.get(new URL(url,base).href);assert.equal(response.status(),200);
      assert.match(response.headers()['content-type']??'',mime);body=await response.body();
    }
    if(bytes) assert.deepEqual(body,bytes,'Resource body differs at '+url);
    return {kind:url.startsWith('data:')?'inline':'url',url,sha256:sha256(body)};
  }
  const urls:Array<Record<string,unknown>>=[];
  for(const [selector,width,path] of [
    ['img[alt="插件资源示例"]',48,null],['[data-testid="unicode-asset"]',48,'src/assets/图示 space.svg'],['[data-testid="binary-asset"]',1,'src/assets/pixel.png'],
  ] as const) {
    const image=page.locator(selector);await image.evaluate(async (element:HTMLImageElement)=>{await element.decode();});
    const info=await image.evaluate((element:HTMLImageElement)=>({width:element.naturalWidth,src:element.currentSrc}));assert.equal(info.width,width);
    urls.push(await checkUrl(info.src,path?.endsWith('.png')?/image\/png/:/image\/svg\+xml/,path?fixture.files.get(path):undefined));
  }
  const background=style.background.match(/^url\(["']?(.*?)["']?\)$/);assert.ok(background);
  urls.push(await checkUrl(background[1]!,/image\/svg\+xml/));
  if(fixture.font) {
    const font=await page.evaluate(async () => {
      await document.fonts.load('16px "Cormi Fixture Sans"','Plugin');await document.fonts.ready;
      const loaded=[...document.fonts].filter(f=>f.family.replace(/["']/g,'')==='Cormi Fixture Sans'&&f.status==='loaded').length;
      let source='';
      const pending:CSSRuleList[]=[];for(const sheet of document.styleSheets)pending.push(sheet.cssRules);
      while(pending.length){for(const rule of pending.pop()!){
        if(rule instanceof CSSFontFaceRule&&rule.style.fontFamily.includes('Cormi Fixture Sans'))source=rule.style.getPropertyValue('src');
        else if(rule instanceof CSSImportRule&&rule.styleSheet)pending.push(rule.styleSheet.cssRules);
      }}
      return {loaded,source,family:getComputedStyle(document.querySelector('h1')!).fontFamily};
    });
    assert.equal(font.loaded,1);assert.match(font.family,/Cormi Fixture Sans/);
    const source=font.source.match(/url\(["']?([^"')]+)["']?\)/);assert.ok(source,'No loaded font source');
    urls.push(await checkUrl(source[1]!,/font\/woff2|application\/font-woff|application\/octet-stream/,fixture.files.get('src/assets/validation-font.woff2')));
  }
  assert.equal(await page.locator('cormi-development-overlay,vite-error-overlay').count(),0);
  return {style,resources:urls,fontChecked:fixture.font};
}
