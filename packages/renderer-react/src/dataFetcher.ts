import type { PluginManager } from './plugin.ts'

export interface ServerLoaderRequest {
  url: string
  options: RequestInit
}

function withEndSlash(str = '') {
  return str.endsWith('/') ? str : `${str}/`
}

/**
 * Fetch the `serverLoader` data of route `id` for the current page from the
 * server (`<base>__serverLoader?route=<id>&url=<href>`). The request can be
 * rewritten with the runtime hook `modifyServerLoaderRequest`.
 */
export function fetchServerLoader(opts: {
  id: string
  basename?: string
  pluginManager?: PluginManager
  url?: string
}): Promise<any> {
  const query = new URLSearchParams({
    route: opts.id,
    url: opts.url ?? window.location.href,
  }).toString()
  let req: ServerLoaderRequest = {
    url: `${withEndSlash(window.__cormiServerLoaderPath__ || opts.basename)}__serverLoader?${query}`,
    options: { credentials: 'include' },
  }
  if (opts.pluginManager) {
    req = opts.pluginManager.applyPlugins({
      key: 'modifyServerLoaderRequest',
      type: 'modify',
      initialValue: req,
      args: { id: opts.id, basename: opts.basename },
    })
  }
  return fetch(req.url, req.options).then((res) => {
    if (!res.ok) throw new Error(`serverLoader of route ${opts.id} failed with status ${res.status}`)
    return res.json()
  })
}
