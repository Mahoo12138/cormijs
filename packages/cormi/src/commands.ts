import { assertActive, CormiError, type CommandHandler, type CommandMiddleware, type CommandRegistry, type Plugin } from '@cormijs/core';

export const commandPlugin: Plugin.Object<void> = {
  name: 'cormi:commands',
  apply: ctx => {
    const handlers = new Map<string, CommandHandler>();
    const middleware = new Map<string, { run: CommandMiddleware }>();
    ctx.get('diagnostics')?.add('commands', () => [...handlers.keys()].sort().map(id => ({ kind: 'command', id })));
    ctx.provide('commands', {
      use(id, run) {
        assertActive(ctx);
        if (!id || middleware.has(id) || typeof run !== 'function') throw new CormiError('COMMAND_MIDDLEWARE_CONFLICT', 'Invalid or duplicate command middleware.');
        const entry = { run }; middleware.set(id, entry);
        return () => { if (middleware.get(id) === entry) middleware.delete(id); };
      },
      register(name, handler) {
        if (!/^[a-z][a-z0-9-]*$/.test(name) || handlers.has(name)) throw new CormiError('COMMAND_CONFLICT', `Duplicate or invalid command: ${name}`);
        handlers.set(name, handler);
        return () => { if (handlers.get(name) === handler) handlers.delete(name); };
      },
      async execute(name, request) {
        const handler = handlers.get(name);
        if (!handler) throw new CormiError('COMMAND_MISSING', `No plugin registered command: ${name}`, { available: [...handlers.keys()] });
        assertActive(ctx); request.signal.throwIfAborted();
        const snapshot = [...middleware.values()];
        const invoke = async (index: number, input: Parameters<CommandHandler>[0]): ReturnType<CommandHandler> => {
          assertActive(ctx); request.signal.throwIfAborted(); input.signal.throwIfAborted();
          const item = snapshot[index]; if (!item) return handler(input);
          let called = false, open = true;
          try {
            return await item.run(name, input, next => {
              if (!open) throw new CormiError('COMMAND_NEXT_EXPIRED', 'A middleware continuation cannot outlive its invocation.');
              if (called) throw new CormiError('COMMAND_NEXT_REPEATED', 'A middleware cannot execute a command twice.');
              called = true; return invoke(index + 1, next);
            });
          } finally { open = false; }
        };
        return invoke(0, request);
      },
      names: () => [...handlers.keys()].sort(),
    } satisfies CommandRegistry);
    ctx.effect(() => () => { handlers.clear(); middleware.clear(); });
  },
};
