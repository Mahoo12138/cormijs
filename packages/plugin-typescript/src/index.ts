import { assertActive, CormiError, type Plugin, type CommandRequest, type CommandResult } from '@cormijs/core';
import type {} from '@cormijs/plugin-web';
import { readInspection } from '@cormijs/plugin-web';
import { checkTypes } from './check.js';
import { typecheckOptions, type TypeChecker, type TypecheckOptions } from './types.js';
export { checkTypes } from './check.js';
export type { TypecheckOptions, TypecheckResult, TypeDiagnostic, TypeChecker } from './types.js';

export const typescriptServicePlugin: Plugin.Object<void> = {
  name: 'cormi:typescript-service',
  apply(ctx) { ctx.provide('typechecker', { check: checkTypes } satisfies TypeChecker); },
};
/** Command orchestration is independent of the chosen compiler implementation. */
export const typecheckCommandPlugin: Plugin.Object<TypecheckOptions | void> = {
  name: 'cormi:typecheck-command', inject: ['commands', 'application', 'typechecker'],
  apply(ctx, input) {
    const options = typecheckOptions(input);
    const application = ctx.application, checker = ctx.typechecker;
    const lifetime = new AbortController(), pending = new Set<Promise<CommandResult>>();
    async function execute(original: CommandRequest): Promise<CommandResult> {
      assertActive(ctx);
      const signal = AbortSignal.any([original.signal, lifetime.signal]); signal.throwIfAborted();
      const prepared = await application.prepare({ ...original, signal, command: 'typecheck' });
      try {
        signal.throwIfAborted();
        if (!prepared.typecheck) throw new CormiError('TYPECHECK_UNSUPPORTED', 'Application compiler does not provide typechecking roots.');
        const before = readInspection(original.root);
        const result = await checker.check(original.root, prepared.typecheck.files, signal, options);
        signal.throwIfAborted();
        if (readInspection(original.root).generation !== before.generation) throw new CormiError('TYPECHECK_INPUT_CHANGED', 'Generated snapshot changed during typechecking.');
        return { kind: 'result', data: { ...result, generation: before.generation } };
      } finally { await prepared.close(); }
    }
    ctx.effect(() => ctx.commands.register('typecheck', request => {
      const task = execute(request); pending.add(task);
      void task.then(() => pending.delete(task), () => pending.delete(task)); return task;
    }));
    ctx.effect(() => async () => { lifetime.abort(); await Promise.allSettled([...pending]); });
  },
};
/** Backward-compatible native composition. No TypeScript policy is installed by core or launcher. */
export const typescriptPlugin: Plugin.Object<TypecheckOptions | void> = {
  name: 'cormi:typescript',
  apply(ctx, input) {
    const options = typecheckOptions(input);
    ctx.plugin(typescriptServicePlugin); ctx.plugin(typecheckCommandPlugin, options);
  },
};
