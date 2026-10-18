import { clientModule, defineReactFeature } from '@cormijs/plugin-react';

/** Only public display settings cross into the browser. This factory can be used by any application. */
export function statusFeature(options: { label: string; parentId?: string }) {
  return defineReactFeature({
    id: 'example:status',
    routes: [{
      id: 'feature:status', parentId: options.parentId, path: 'status',
      module: clientModule('./client/Page.tsx', import.meta.url),
      meta: { title: '功能插件', feature: 'status', description: '由 Node 插件贡献的客户端页面' },
    }],
    runtime: [{ id: 'example:status-runtime', module: clientModule('./client/runtime.tsx', import.meta.url), options: { label: options.label } }],
  });
}
