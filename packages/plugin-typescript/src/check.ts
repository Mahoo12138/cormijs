import { CormiError } from '@cormijs/core';
import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import type * as TS from 'typescript';
import { checkingSystem } from './filesystem.js';
import { projectGraph } from './projects.js';
import { typecheckOptions, type TypeDiagnostic, type TypecheckOptions, type TypecheckResult } from './types.js';

/** Checks sources without filesystem emission. Referenced declaration outputs live only in this call's overlay. */
export async function checkTypes(root: string, generated: readonly string[], signal: AbortSignal, input: TypecheckOptions = {}): Promise<TypecheckResult> {
  signal.throwIfAborted(); root = realpathSync(root);
  const options = typecheckOptions(input), ts = await import('typescript'); signal.throwIfAborted();
  const required = generated.map(file => {
    const absolute = resolve(root, file), local = relative(root, absolute);
    if (isAbsolute(file) || !['.cormi/app.tsx', '.cormi/routes.d.ts', '.cormi/locale.d.ts', '.cormi/loaders.d.ts'].includes(local.split(sep).join('/'))
      || realpathSync(absolute) !== absolute || !lstatSync(absolute).isFile()) throw new CormiError('TYPECHECK_PATH_INVALID', 'Unexpected generated typecheck input.');
    return absolute;
  });
  const io = checkingSystem(ts, root, signal), graph = projectGraph(ts, root, io.system, required, options);
  const diagnostics: Array<{ diagnostic: TS.Diagnostic; project?: string }> = graph.fatal.map(diagnostic => ({ diagnostic }));
  const cancellation: TS.CancellationToken = { isCancellationRequested: () => signal.aborted, throwIfCancellationRequested: () => signal.throwIfAborted() };
  let exit: TS.ExitStatus = ts.ExitStatus.Success;
  if (!diagnostics.length && graph.solution) {
    const inputs = new Set([...graph.projects.values()].flatMap(project => project.parsed.fileNames.map(io.key)));
    const outputOwners = new Map<string, string>();
    for (const project of graph.projects.values()) {
      const parsed = project.parsed;
      // Keep TypeScript's parsed config identity (including its non-enumerable metadata).
      parsed.options.noCheck = false; parsed.options.noEmitOnError = true;
      if (project.generated) parsed.options.allowImportingTsExtensions = true;
      // Composite libraries retain declaration boundaries; non-emitting leaves remain non-emitting.
      if (parsed.options.composite && !parsed.options.noEmit) {
        parsed.options.emitDeclarationOnly = true; parsed.options.declarationMap = false;
        parsed.options.sourceMap = false; parsed.options.inlineSourceMap = false;
      } else parsed.options.noEmit = true;
      if (parsed.options.tsBuildInfoFile) {
        const key = io.key(parsed.options.tsBuildInfoFile), owner = outputOwners.get(key);
        if (inputs.has(key) || owner && owner !== project.file) throw new CormiError('TYPECHECK_OUTPUT_CONFLICT', 'Build information conflicts with another project or source input.');
        outputOwners.set(key, project.file);
      }
      if (parsed.options.noEmit) continue;
      for (const file of parsed.fileNames) {
        for (const output of ts.getOutputFileNames(parsed, file, !ts.sys.useCaseSensitiveFileNames)) {
          const key = io.key(output), owner = outputOwners.get(key);
          if (inputs.has(key) || owner && owner !== project.file) throw new CormiError('TYPECHECK_OUTPUT_CONFLICT', 'Referenced projects have overlapping outputs or overwrite a source input.');
          outputOwners.set(key, project.file);
        }
      }
    }
    io.hide(outputOwners.keys());
    const host = ts.createSolutionBuilderHost(io.system, undefined, diagnostic => diagnostics.push({ diagnostic }), () => {});
    host.getParsedCommandLine = file => graph.projects.get(resolve(file))?.parsed;
    host.afterProgramEmitAndDiagnostics = () => signal.throwIfAborted();
    exit = ts.createSolutionBuilder(host, [graph.entry], { force: true, stopBuildOnErrors: true }).build(undefined, cancellation);
  } else if (!diagnostics.length) {
    const project = graph.projects.get(graph.entry)!;
    const parsed = project.parsed;
    const compilerOptions: TS.CompilerOptions = { ...parsed.options, noEmit: true, noCheck: false, incremental: false,
      composite: false, tsBuildInfoFile: undefined, emitDeclarationOnly: false, allowImportingTsExtensions: true };
    const host = ts.createCompilerHost(compilerOptions);
    host.readFile = io.system.readFile; host.fileExists = io.system.fileExists;
    host.readDirectory = io.system.readDirectory; host.directoryExists = io.system.directoryExists;
    host.getDirectories = io.system.getDirectories; host.realpath = io.system.realpath;
    host.getSourceFile = (file, languageVersion) => {
      const text = io.system.readFile(file); return text === undefined ? undefined : ts.createSourceFile(file, text, languageVersion);
    };
    host.writeFile = () => { throw new CormiError('TYPECHECK_WRITE_FORBIDDEN', 'Typechecking must not emit filesystem output.'); };
    const program = ts.createProgram({ rootNames: parsed.fileNames, options: compilerOptions, host });
    diagnostics.push(...[...parsed.errors, ...ts.getPreEmitDiagnostics(program, undefined, cancellation)].map(diagnostic => ({ diagnostic, project: graph.local(project.file) })));
  }
  io.verify(); signal.throwIfAborted();
  const errors: TypeDiagnostic[] = diagnostics.filter(item => item.diagnostic.category === ts.DiagnosticCategory.Error).map(({ diagnostic: item, project }) => {
    const where = item.file && item.start !== undefined ? item.file.getLineAndCharacterOfPosition(item.start) : undefined;
    return { code: item.code, message: ts.flattenDiagnosticMessageText(item.messageText, '\n'), ...(project ? { project } : {}),
      ...(item.file ? { file: graph.local(item.file.fileName) } : {}), ...(where ? { line: where.line + 1, column: where.character + 1 } : {}) };
  });
  if (errors.length || exit !== ts.ExitStatus.Success) throw new CormiError('TYPECHECK_FAILED', `${errors.length} TypeScript error(s):\n` + errors.slice(0, 20)
    .map(item => `${item.file ?? '<config>'}${item.line ? `:${item.line}:${item.column}` : ''} TS${item.code}: ${item.message}`).join('\n'), { diagnostics: errors, exit });
  const projects = [...graph.projects.values()];
  return Object.freeze({ compiler: 'typescript', version: ts.version, files: new Set(projects.flatMap(project => project.parsed.fileNames)).size,
    generatedFiles: Object.freeze([...generated]), mode: graph.solution ? 'solution' : 'single',
    projects: Object.freeze(projects.map(project => Object.freeze({ config: graph.local(project.file), files: project.parsed.fileNames.length,
      references: Object.freeze(project.references.map(graph.local)), generated: project.generated }))),
    virtualDeclarations: [...io.outputs.keys()].filter(file => /\.d\.[cm]?ts$/.test(file)).length });
}
