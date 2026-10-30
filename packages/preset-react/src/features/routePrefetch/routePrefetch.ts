import type { IApi } from '../../types.ts'

/** `routePrefetch: { defaultPrefetch: 'intent' }` sets the default `prefetch` of `<Link>`. */
export default (api: IApi) => {
  api.describe({
    key: 'routePrefetch',
    config: {
      schema: ({ zod }) => zod.object({
        defaultPrefetch: zod.enum(['none', 'intent', 'render', 'viewport']),
        defaultPrefetchTimeout: zod.number(),
      }).partial(),
      onChange: api.ConfigChangeType.regenerateTmpFiles,
    },
    enableBy: api.EnableBy.config,
  })

  api.addEntryCodeAhead(() => {
    const { defaultPrefetch = 'intent', defaultPrefetchTimeout = 50 } = api.config.routePrefetch
    return `window.__CORMI_ROUTE_PREFETCH__ = ${JSON.stringify({ defaultPrefetch, defaultPrefetchTimeout })};`
  })
}
