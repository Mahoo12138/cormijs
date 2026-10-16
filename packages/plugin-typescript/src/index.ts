import { assertActive, CormiError, type Plugin, type CommandRequest, type CommandResult } from '@cormijs/core';
import type {} from '@cormijs/plugin-web';
import { readInspection } from '@cormijs/plugin-web';
import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type * as TS from 'typescript';

export interface TypeDiagnostic { readonly code: number; readonly message: string; readonly file?: string; readonly line?: number; readonly column?: number }
/** Check application sources and generated roots, never emit files or execute page modules. */
export async function checkTypes(root: string, generated: readonly string[], signal: AbortSignal): Promise<{ compiler: string; version: string; files: number; generatedFiles: readonly string[] }> {
  signal.throwIfAborted(); root = realpathSync(root);
  const ts = await import('typescript'); signal.throwIfAborted();
  const configFile = join(root, 'tsconfig.json');
  const configBefore = existsSync(configFile) ? readFileSync(configFile, 'utf8') : undefined;
  const fatal: TS.Diagnostic[] = [];
  const configReads = new Map<string, string | undefined>();
  const configHost = { ...ts.sys, readFile(file: string) {
    const text = ts.sys.readFile(file); configReads.set(file, text); return text;
  }, onUnRecoverableConfigFileDiagnostic: (error: TS.Diagnostic) => { fatal.push(error); } };
  let parsed: TS.ParsedCommandLine;
  if (configBefore !== undefined) {
    parsed = ts.getParsedCommandLineOfConfigFile(configFile, {}, configHost)
      ?? { options: {}, fileNames: [], errors: fatal };
  } else {
    parsed = ts.parseJsonConfigFileContent({ compilerOptions: {
      target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      lib: ['ES2023', 'DOM', 'DOM.Iterable'], strict: true, skipLibCheck: true,
    }, include: ['src/**/*'] }, ts.sys, root);
  }
  if (parsed.projectReferences?.length) throw new CormiError('TYPECHECK_REFERENCES_UNSUPPORTED', 'Project-reference solution builds are not yet supported by cormi typecheck.');
  const required = generated.map(file => {
    const absolute = resolve(root, file), local = relative(root, absolute);
    if (isAbsolute(file) || local.startsWith('..') || !['.cormi/app.tsx', '.cormi/routes.d.ts'].includes(local.split(sep).join('/'))
      || realpathSync(absolute) !== absolute || !lstatSync(absolute).isFile()) throw new CormiError('TYPECHECK_PATH_INVALID', 'Unexpected generated typecheck input.');
    return absolute;
  });
  const roots = [...new Set([...parsed.fileNames, ...required])];
  const options: TS.CompilerOptions = { ...parsed.options, noEmit: true, noCheck: false, incremental: false,
    composite: false, tsBuildInfoFile: undefined, emitDeclarationOnly: false, allowImportingTsExtensions: true };
  const host = ts.createCompilerHost(options);
  host.writeFile = () => { throw new CormiError('TYPECHECK_WRITE_FORBIDDEN', 'Typechecking must not emit output.'); };
  const program = ts.createProgram({ rootNames: roots, options, host });
  const diagnostics = [...fatal, ...parsed.errors.filter(error => error.code !== 18003 || !required.length), ...ts.getPreEmitDiagnostics(program)];
  for (const source of program.getSourceFiles()) {
    const local = relative(root, source.fileName);
    if (!local.startsWith('..') && !isAbsolute(local) && !local.split(sep).includes('node_modules')) {
      if (readFileSync(source.fileName, 'utf8').replace(/^\uFEFF/, '') !== source.text) throw new CormiError('TYPECHECK_INPUT_CHANGED', 'Application sources changed during typechecking; run it again.');
    }
  }
  for (const [file, content] of configReads) {
    if (ts.sys.readFile(file) !== content) throw new CormiError('TYPECHECK_INPUT_CHANGED', 'An inherited compiler configuration changed during typechecking.');
  }
  if ((existsSync(configFile) ? readFileSync(configFile, 'utf8') : undefined) !== configBefore) throw new CormiError('TYPECHECK_INPUT_CHANGED', 'tsconfig.json changed during typechecking.');
  signal.throwIfAborted();
  const errors: TypeDiagnostic[] = diagnostics.filter(item => item.category === ts.DiagnosticCategory.Error).map(item => {
    const where = item.file && item.start !== undefined ? item.file.getLineAndCharacterOfPosition(item.start) : undefined;
    return { code: item.code, message: ts.flattenDiagnosticMessageText(item.messageText, '\n'),
      ...(item.file ? { file: relative(root, item.file.fileName).split(sep).join('/') } : {}),
      ...(where ? { line: where.line + 1, column: where.character + 1 } : {}) };
  });
  if (errors.length) throw new CormiError('TYPECHECK_FAILED', `${errors.length} TypeScript error(s):\n` + errors.slice(0, 20)
    .map(item => `${item.file ?? '<config>'}${item.line ? `:${item.line}:${item.column}` : ''} TS${item.code}: ${item.message}`).join('\n'), { diagnostics: errors });
  return { compiler: 'typescript', version: ts.version, files: roots.length, generatedFiles: generated };
}

/** Optional official command plugin: neither the launcher nor the core imports TypeScript. */
export const typescriptPlugin: Plugin.Object<void> = {
  name: 'cormi:typescript', inject: ['commands', 'application'],
  apply: ctx => {
    const application = ctx.application, lifetime = new AbortController(), pending = new Set<Promise<CommandResult>>();
    async function execute(original: CommandRequest): Promise<CommandResult> {
      assertActive(ctx);
      const signal = AbortSignal.any([original.signal, lifetime.signal]); signal.throwIfAborted();
      const prepared = await application.prepare({ ...original, signal, command: 'typecheck' });
      try {
        if (!prepared.typecheck) throw new CormiError('TYPECHECK_UNSUPPORTED', 'Application compiler does not provide typechecking roots.');
        const before = readInspection(original.root);
        const result = await checkTypes(original.root, prepared.typecheck.files, signal);
        if (readInspection(original.root).generation !== before.generation) throw new CormiError('TYPECHECK_INPUT_CHANGED', 'Generated snapshot changed during typechecking.');
        return { kind: 'result', data: { ...result, generation: before.generation } };
      } finally { await prepared.close(); }
    }
    ctx.effect(() => ctx.commands.register('typecheck', request => {
      const task = execute(request); pending.add(task);
      task.then(() => pending.delete(task), () => pending.delete(task)); return task;
    }));
    ctx.effect(() => async () => { lifetime.abort(); await Promise.allSettled([...pending]); });
  },
};
