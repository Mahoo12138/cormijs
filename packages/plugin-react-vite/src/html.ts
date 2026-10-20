import { CormiError, type Plugin } from '@cormijs/core';
import type {} from '@cormijs/plugin-vite';

export interface HtmlMeta {
  readonly name?: string;
  readonly property?: string;
  readonly httpEquiv?: string;
  readonly content: string;
}
export interface HtmlLink {
  readonly rel: string;
  readonly href: string;
  readonly type?: string;
  readonly sizes?: string;
  readonly crossorigin?: string;
}
export interface HtmlPluginOptions {
  readonly title?: string;
  readonly lang?: string;
  readonly favicon?: string;
  readonly metas?: readonly HtmlMeta[];
  readonly links?: readonly HtmlLink[];
}
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const short = (value: unknown, max = 512) => typeof value === 'string' && value.length <= max && !/[\0\r\n]/.test(value);

function validate(input: unknown): HtmlPluginOptions {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CormiError('HTML_INVALID', 'Invalid HTML plugin options.');
  const options = input as Record<string, unknown>;
  if (Object.keys(options).some(key => !['title', 'lang', 'favicon', 'metas', 'links'].includes(key))) throw new CormiError('HTML_INVALID', 'Unknown HTML option.');
  for (const key of ['title', 'lang', 'favicon']) {
    if (options[key] !== undefined && !short(options[key])) throw new CormiError('HTML_INVALID', `Invalid HTML ${key}.`);
  }
  if (options.metas !== undefined) {
    if (!Array.isArray(options.metas) || options.metas.length > 32) throw new CormiError('HTML_INVALID', 'metas must be a bounded array.');
    for (const meta of options.metas) {
      if (!meta || typeof meta !== 'object' || Array.isArray(meta)) throw new CormiError('HTML_INVALID', 'Invalid meta entry.');
      const row = meta as Record<string, unknown>;
      const selectors = ['name', 'property', 'httpEquiv'].filter(key => row[key] !== undefined);
      if (Object.keys(row).some(key => !['name', 'property', 'httpEquiv', 'content'].includes(key))
        || selectors.length !== 1 || !short(row[selectors[0]!]) || !short(row.content, 4096)) throw new CormiError('HTML_INVALID', 'Meta entries need one selector and content.');
    }
  }
  if (options.links !== undefined) {
    if (!Array.isArray(options.links) || options.links.length > 32) throw new CormiError('HTML_INVALID', 'links must be a bounded array.');
    for (const link of options.links) {
      if (!link || typeof link !== 'object' || Array.isArray(link)) throw new CormiError('HTML_INVALID', 'Invalid link entry.');
      const row = link as Record<string, unknown>;
      if (Object.keys(row).some(key => !['rel', 'href', 'type', 'sizes', 'crossorigin'].includes(key))
        || !short(row.rel) || !short(row.href, 2048)
        || ['type', 'sizes', 'crossorigin'].some(key => row[key] !== undefined && !short(row[key]))) throw new CormiError('HTML_INVALID', 'Invalid link entry.');
    }
  }
  return Object.freeze({
    ...(options.title !== undefined ? { title: options.title as string } : {}),
    ...(options.lang !== undefined ? { lang: options.lang as string } : {}),
    ...(options.favicon !== undefined ? { favicon: options.favicon as string } : {}),
    ...(options.metas !== undefined ? { metas: Object.freeze((options.metas as HtmlMeta[]).map(meta => Object.freeze({ ...meta }))) } : {}),
    ...(options.links !== undefined ? { links: Object.freeze((options.links as HtmlLink[]).map(link => Object.freeze({ ...link }))) } : {}),
  });
}

/** Deterministic head injection with escaped attribute/text values. */
export function applyHtmlHead(html: string, input: HtmlPluginOptions): string {
  if (typeof html !== 'string' || !html) throw new CormiError('HTML_INVALID', 'Expected HTML text.');
  const options = validate(input);
  if (!/<\/head\s*>/i.test(html)) throw new CormiError('HTML_INVALID', 'index.html must contain a closing </head>.');
  let result = html;
  if (options.lang !== undefined) {
    result = /<html\b[^>]*>/i.test(result)
      ? result.replace(/<html\b([^>]*)>/i, (_match, attrs: string) => {
        const cleaned = attrs.replace(/\s+lang\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i, '');
        return `<html${cleaned} lang="${escape(options.lang!)}">`;
      })
      : result.replace(/<head\s*>/i, `<html lang="${escape(options.lang)}"><head>`);
  }
  if (options.title !== undefined) {
    const title = `<title>${escape(options.title)}</title>`;
    result = /<title\b[^>]*>[\s\S]*?<\/title>/i.test(result) ? result.replace(/<title\b[^>]*>[\s\S]*?<\/title>/i, title) : result.replace(/<\/head\s*>/i, `  ${title}\n</head>`);
  }
  const tags: string[] = [];
  if (options.favicon) tags.push(`<link rel="icon" href="${escape(options.favicon)}" />`);
  for (const meta of options.metas ?? []) {
    const selector = meta.name !== undefined ? 'name' : meta.property !== undefined ? 'property' : 'http-equiv';
    const value = meta.name ?? meta.property ?? meta.httpEquiv!;
    tags.push(`<meta ${selector}="${escape(value)}" content="${escape(meta.content)}" />`);
  }
  for (const link of options.links ?? []) {
    const attributes = [`rel="${escape(link.rel)}"`, `href="${escape(link.href)}"`];
    if (link.type) attributes.push(`type="${escape(link.type)}"`);
    if (link.sizes) attributes.push(`sizes="${escape(link.sizes)}"`);
    if (link.crossorigin) attributes.push(`crossorigin="${escape(link.crossorigin)}"`);
    tags.push(`<link ${attributes.join(' ')} />`);
  }
  return tags.length ? result.replace(/<\/head\s*>/i, `  ${tags.join('\n  ')}\n</head>`) : result;
}

/** Optional Vite bridge: configure title, lang, meta, links and favicon without owning index.html. */
export const htmlPlugin: Plugin.Object<HtmlPluginOptions> = {
  name: 'cormi:html', inject: ['vite'],
  apply(ctx, options) {
    const settings = validate(options);
    ctx.effect(() => ctx.vite.add('cormi:html', () => ({
      name: 'cormi:html',
      transformIndexHtml(html: string) { return applyHtmlHead(html, settings); },
    })));
  },
};
