export type IScript =
  | string
  | Partial<{
    async: boolean
    charset: string
    content: string
    crossOrigin: string | null
    defer: boolean
    src: string
    type: string
    [key: string]: any
  }>

export type IStyle =
  | string
  | Partial<{
    content: string
    src: string
    type: string
    [key: string]: any
  }>

export type ILink = Partial<{
  as: string
  crossOrigin: string | null
  disabled: boolean
  href: string
  hreflang: string
  imageSizes: string
  imageSrcset: string
  integrity: string
  media: string
  referrerPolicy: string
  rel: string
  rev: string
  target: string
  type: string
  [key: string]: any
}>

export type IMeta = Partial<{
  charset: string
  content: string
  'http-equiv': string
  name: string
  scheme: string
  [key: string]: any
}>

export interface MarkupOptions {
  /** id of the element the app mounts into */
  mountElementId?: string
  /** markup inside the mount element (server-rendered app) */
  rootMarkup?: string
  title?: string
  lang?: string
  favicons?: string[]
  metas?: IMeta[]
  links?: ILink[]
  styles?: IStyle[]
  headScripts?: IScript[]
  scripts?: IScript[]
  /** treat scripts without `type` as ES modules */
  esmScript?: boolean
  modifyHTML?: (html: string, args: { path?: string }) => Promise<string> | string
  path?: string
}

const RE_URL = /^(http:|https:)?\/\//

export function isUrl(str: string) {
  return RE_URL.test(str)
    || (str.startsWith('/') && !str.startsWith('/*'))
    || str.startsWith('./')
    || str.startsWith('../')
}

export function normalizeScripts(scripts: IScript[]) {
  return scripts.map(normalizeScript)
}

export function normalizeScript(script: IScript) {
  if (typeof script === 'string') {
    return isUrl(script) ? { src: script } : { content: script }
  }
  if (script && typeof script === 'object') {
    if (typeof script.src !== 'string' && typeof script.content !== 'string') {
      throw new Error('Script must have either a "src" or a "content" property.')
    }
    return script
  }
  throw new Error(`Invalid script type: ${typeof script}`)
}

export function normalizeStyles(styles: IStyle[]) {
  return styles.map(normalizeStyle)
}

export function normalizeStyle(style: IStyle) {
  if (typeof style === 'string') {
    return isUrl(style) ? { src: style } : { content: style }
  }
  if (style && typeof style === 'object') {
    if (typeof style.src !== 'string' && typeof style.content !== 'string') {
      throw new Error('Style must have either a "src" or a "content" property.')
    }
    return style
  }
  throw new Error(`Invalid style type: ${typeof style}`)
}

export function escapeAttribute(value: string) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function propsToString(props: Record<string, any>, filters: string[] = []) {
  return Object.keys(props)
    .filter(key => !filters.includes(key) && props[key] !== false && props[key] !== undefined && props[key] !== null)
    .map((key) => {
      const value = props[key]
      if (value === true) return key
      return `${key}="${escapeAttribute(String(value))}"`
    })
    .join(' ')
}

function withSpace(attrs: string) {
  return attrs ? ` ${attrs}` : ''
}

function withDefaultMetas(metas: IMeta[] = []) {
  const hasAttr = (key: string, value?: string) => metas.some((m) => {
    return value ? m[key]?.toLowerCase() === value.toLowerCase() : m[key]
  })
  return [
    !hasAttr('charset') && { charset: 'utf-8' },
    !hasAttr('name', 'viewport') && {
      name: 'viewport',
      content: 'width=device-width, initial-scale=1.0',
    },
    ...metas,
  ].filter(Boolean) as IMeta[]
}

/** Generate the HTML document of the app (umi's `getMarkup`). */
export async function getMarkup(opts: MarkupOptions) {
  const scriptTag = (script: ReturnType<typeof normalizeScript>) => {
    const isEsmScript = opts.esmScript && !('type' in script)
    const attrs = withSpace(propsToString(script, ['src', 'content']))
    const type = isEsmScript ? ' type="module"' : ''
    return script.src
      ? `<script${type}${attrs} src="${escapeAttribute(script.src)}"></script>`
      : `<script${type}${attrs}>${script.content}</script>`
  }
  const styleTag = (style: ReturnType<typeof normalizeStyle>) => {
    const attrs = withSpace(propsToString(style, ['src', 'content']))
    return style.src
      ? `<link rel="stylesheet"${attrs} href="${escapeAttribute(style.src)}" />`
      : `<style${attrs}>${style.content}</style>`
  }
  const tag = (tagName: string, attrs: Record<string, any>) => `<${tagName}${withSpace(propsToString(attrs))} />`

  const favicons = (opts.favicons || []).map(href => `<link rel="shortcut icon" href="${escapeAttribute(href)}">`)
  const title = opts.title ? `<title>${opts.title}</title>` : ''
  const metas = withDefaultMetas(opts.metas).map(meta => tag('meta', meta))
  const links = (opts.links || []).map(link => tag('link', link))
  const styles = normalizeStyles(opts.styles || []).map(styleTag)
  const headScripts = normalizeScripts(opts.headScripts || []).map(scriptTag)
  const scripts = normalizeScripts(opts.scripts || []).map(scriptTag)
  const mountElementId = opts.mountElementId || 'root'
  let markup = [
    '<!DOCTYPE html>',
    `<html${opts.lang ? ` lang="${escapeAttribute(opts.lang)}"` : ''}>`,
    '<head>',
    metas.join('\n'),
    favicons.join('\n'),
    title,
    links.join('\n'),
    styles.join('\n'),
    headScripts.join('\n'),
    '</head>',
    '<body>',
    `<div id="${escapeAttribute(mountElementId)}">${opts.rootMarkup ?? ''}</div>`,
    scripts.join('\n'),
    '</body>',
    '</html>',
  ].filter(Boolean).join('\n')
  if (opts.modifyHTML) {
    markup = await opts.modifyHTML(markup, { path: opts.path })
  }
  return markup
}

/**
 * Put server-rendered markup into the mount element of an HTML template, and
 * extra tags (loader data script, CSS-in-JS styles) into head / body.
 */
export function injectIntoTemplate(template: string, opts: {
  mountElementId?: string
  html?: string
  head?: string
  bodyEnd?: string
}) {
  let html = template
  const id = opts.mountElementId || 'root'
  if (opts.html) {
    const mountRE = new RegExp(`(<div[^>]*\\bid=["']${id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}["'][^>]*>)([\\s\\S]*?)(</div>)`)
    html = html.replace(mountRE, (_, open, _inner, close) => `${open}${opts.html}${close}`)
  }
  if (opts.head) html = html.replace(/<\/head>/i, `${opts.head}</head>`)
  if (opts.bodyEnd) html = html.replace(/<\/body>/i, `${opts.bodyEnd}</body>`)
  return html
}

/** Serialize data into a `<script>` safely (no `</script>` breakouts). */
export function serializeForScript(data: unknown) {
  return JSON.stringify(data ?? null)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}
