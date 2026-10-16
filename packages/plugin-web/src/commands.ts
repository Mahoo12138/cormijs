import { CormiError, type CommandRequest, type Plugin } from '@cormijs/core';
import type { BuildPlan } from '@cormijs/builder';
import type {} from './index.js';

function plan(request: CommandRequest): BuildPlan {
  const input = request.options;
  for (const key of Object.keys(input)) if (!['entry', 'base', 'outDir', 'server'].includes(key)) throw new CormiError('CONFIG_INVALID', `Unknown Web option: app.${key}`);
  for (const key of ['entry', 'base', 'outDir']) if (input[key] !== undefined && typeof input[key] !== 'string') throw new CormiError('CONFIG_INVALID', `app.${key} must be a string`);
  const server = input.server;
  if (server !== undefined) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) throw new CormiError('CONFIG_INVALID', 'app.server must be an object');
    for (const key of Object.keys(server)) if (!['host', 'port'].includes(key)) throw new CormiError('CONFIG_INVALID', `Unknown option: app.server.${key}`);
    const values = server as Record<string, unknown>;
    if (values.host !== undefined && typeof values.host !== 'string') throw new CormiError('CONFIG_INVALID', 'app.server.host must be a string');
    if (values.port !== undefined && (!Number.isInteger(values.port) || (values.port as number) < 0 || (values.port as number) > 65535)) throw new CormiError('CONFIG_INVALID', 'Invalid app.server.port');
  }
  return { root: request.root, mode: request.mode, entry: input.entry as string ?? 'index.html',
    base: input.base as string ?? '/', outDir: input.outDir as string ?? 'dist',
    server: server as BuildPlan['server'], serverOnlyFiles: request.serverOnlyFiles };
}
/** Command policy is a plugin; the launcher neither imports Web nor switches on bundler names. */
export const webCommandsPlugin: Plugin.Object<void> = {
  name: 'cormi:web-commands', inject: ['commands', 'web'],
  apply: ctx => {
    ctx.effect(() => ctx.commands.register('dev', async request => ({ kind: 'server', handle: await ctx.web.dev(plan(request), request.signal) })));
    ctx.effect(() => ctx.commands.register('build', async request => ({ kind: 'result', data: await ctx.web.build(plan(request), request.signal) })));
    ctx.effect(() => ctx.commands.register('preview', async request => ({ kind: 'server', handle: await ctx.web.preview(plan(request), request.signal) })));
  },
};
