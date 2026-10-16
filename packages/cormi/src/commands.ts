import { CormiError, type CommandHandler, type CommandRegistry, type Plugin } from '@cormijs/core';

export const commandPlugin: Plugin.Object<void> = {
  name: 'cormi:commands',
  apply: ctx => {
    const handlers = new Map<string, CommandHandler>();
    ctx.provide('commands', {
      register(name, handler) {
        if (!/^[a-z][a-z0-9-]*$/.test(name) || handlers.has(name)) throw new CormiError('COMMAND_CONFLICT', `Duplicate or invalid command: ${name}`);
        handlers.set(name, handler);
        return () => { if (handlers.get(name) === handler) handlers.delete(name); };
      },
      async execute(name, request) {
        const handler = handlers.get(name);
        if (!handler) throw new CormiError('COMMAND_MISSING', `No plugin registered command: ${name}`, { available: [...handlers.keys()] });
        return handler(request);
      },
      names: () => [...handlers.keys()].sort(),
    } satisfies CommandRegistry);
    ctx.effect(() => () => { handlers.clear(); });
  },
};
