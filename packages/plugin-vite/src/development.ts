import { CormiError } from '@cormijs/core';
import type { DevelopmentPlan, DevelopmentState } from '@cormijs/builder/development';
import type { Plugin, ViteDevServer } from 'vite';
import { isAbsolute, resolve, sep } from 'node:path';
import { developmentClient } from './development-client.js';

const clientId = '\0cormi:development-client';
/** Copy a bounded whitelist; drop extra keys before sending anything to a client. */
export function copyDevelopmentState(value: DevelopmentState): DevelopmentState {
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || !['ready', 'error'].includes(value.status)
    || typeof value.hasOutput !== 'boolean' || value.status === 'ready' && !value.hasOutput) throw new CormiError('DEVELOPMENT_STATE_INVALID', 'Invalid development state.');
  const text = (v: unknown, max = 1200): string => {
    if (typeof v !== 'string' || v.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)) throw new CormiError('DEVELOPMENT_STATE_INVALID', 'Invalid diagnostic text.');
    return v;
  };
  if (value.status === 'ready') return Object.freeze({ revision: value.revision, status: 'ready', hasOutput: true });
  const d = value.diagnostic;
  if (!d || !Array.isArray(d.files) || d.files.length > 8) throw new CormiError('DEVELOPMENT_STATE_INVALID', 'An error state requires bounded diagnostics.');
  return Object.freeze({ revision: value.revision, status: 'error', hasOutput: value.hasOutput, diagnostic: Object.freeze({
    code: text(d.code, 80), phase: text(d.phase, 80), message: text(d.message), files: Object.freeze(d.files.map(v => text(v, 240))),
    ...(d.pluginId === undefined ? {} : { pluginId: text(d.pluginId, 240) }),
    ...(d.hookId === undefined ? {} : { hookId: text(d.hookId, 240) }),
  }) });
}
/** Transport/presentation belongs to the backend. The compiler supplies no Vite objects. */
export function developmentBridge(root: string, base: string, plan: DevelopmentPlan) {
  const entry = resolve(root, plan.entry);
  if (isAbsolute(plan.entry) || plan.entry !== '.cormi/app.tsx' || !entry.startsWith(root + sep)) throw new CormiError('DEVELOPMENT_ENTRY_INVALID', 'Unsupported recovery entry.');
  let state = copyDevelopmentState(plan.initial), server: ViteDevServer | undefined;
  let disposed = false;
  const normalized = entry.split(sep).join('/');
  const plugin: Plugin = {
    name: 'cormi:development-diagnostics', apply: 'serve', enforce: 'pre',
    configureServer(value) {
      server = value;
      const request = (_data: unknown, client: { send(event: string, data: unknown): void }) => client.send('cormi:development:state', state);
      value.ws.on('cormi:development:request', request);
      // Vite owns its websocket lifecycle; remove the custom listener when the session closes.
      const dispose = () => { disposed = true; value.ws.off('cormi:development:request', request); };
      value.httpServer?.once('close', dispose);
    },
    transformIndexHtml(_html, context) {
      if (!context.server) return;
      return [{ tag: 'script', attrs: { type: 'module', src: base + '@id/__x00__cormi:development-client' }, injectTo: 'head' }];
    },
    resolveId(id) {
      if (id === clientId) return id;
      const clean = id.split('?')[0]!.split(sep).join('/');
      if (!state.hasOutput && [normalized, '/' + plan.entry, '/@fs' + normalized].includes(clean)) return normalized;
    },
    load(id) {
      if (!state.hasOutput && id.split('?')[0] === normalized) return 'export {}; // cormi: awaiting first valid application';
      if (id === clientId) return `import {createHotContext} from ${JSON.stringify(base + '@vite/client')};\nconst hot = createHotContext(${JSON.stringify('/@id/__x00__cormi:development-client')});\n(${developmentClient.toString()})(hot, ${JSON.stringify(state)});`;
    },
  };
  return { plugin, async set(next: DevelopmentState) {
    if (disposed) throw new CormiError('SERVER_CLOSED', 'Development diagnostics session closed.');
    const copy = copyDevelopmentState(next);
    if (copy.revision < state.revision) return;
    if (copy.revision === state.revision) {
      if (JSON.stringify(copy) !== JSON.stringify(state)) throw new CormiError('DEVELOPMENT_STATE_CONFLICT', 'Same revision has conflicting diagnostic state.');
      return;
    }
    const wasPlaceholder = !state.hasOutput; state = copy;
    if (wasPlaceholder && state.hasOutput) {
      const module = server?.moduleGraph.getModuleById(normalized); if (module) server!.moduleGraph.invalidateModule(module);
    }
    const client = server?.moduleGraph.getModuleById(clientId); if (client) server!.moduleGraph.invalidateModule(client);
    server?.ws.send('cormi:development:state', state);
  } };
}
