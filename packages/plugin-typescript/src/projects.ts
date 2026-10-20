import { CormiError } from '@cormijs/core';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type * as TS from 'typescript';
import type { TypecheckOptions } from './types.js';

export interface CheckProject { readonly file: string; readonly parsed: TS.ParsedCommandLine; readonly references: readonly string[]; generated: boolean }
export function projectGraph(ts: typeof TS, root: string, system: TS.System, required: readonly string[], options: TypecheckOptions) {
  const projects = new Map<string, CheckProject>(), active: string[] = [], fatal: TS.Diagnostic[] = [];
  let edges = 0, rootCount = 0;
  const local = (file: string) => relative(root, file).split(sep).join('/');
  function filename(file: string): string {
    const absolute = resolve(root, file), path = relative(root, absolute);
    if (!path || isAbsolute(path) || path === '..' || path.startsWith('..' + sep) || path.split(sep).includes('node_modules')) {
      throw new CormiError('TYPECHECK_PROJECT_INVALID', 'Referenced configurations must stay inside the application root.');
    }
    if (existsSync(absolute) && (realpathSync(absolute) !== absolute || !lstatSync(absolute).isFile())) {
      throw new CormiError('TYPECHECK_PROJECT_INVALID', 'Project configurations must be ordinary non-aliased files.');
    }
    return absolute;
  }
  function visit(input: string) {
    const file = filename(input);
    if (active.includes(file)) throw new CormiError('TYPECHECK_REFERENCE_CYCLE', 'TypeScript project reference cycle.', { projects: [...active, file].map(local) });
    if (projects.has(file)) return;
    if (projects.size >= 64) throw new CormiError('TYPECHECK_LIMIT', 'At most 64 TypeScript projects are supported in one check.');
    const parsed = ts.getParsedCommandLineOfConfigFile(file, {}, { ...system, onUnRecoverableConfigFileDiagnostic: error => fatal.push(error) });
    if (!parsed) return;
    rootCount += parsed.fileNames.length;
    if (rootCount > 20000) throw new CormiError('TYPECHECK_LIMIT', 'TypeScript root-file budget exceeded.');
    const references = (parsed.projectReferences ?? []).map(ref => ts.resolveProjectReferencePath(ref));
    edges += references.length;
    if (edges > 256) throw new CormiError('TYPECHECK_LIMIT', 'TypeScript reference-edge budget exceeded.');
    const entry = { file, parsed, references, generated: false }; projects.set(file, entry); active.push(file);
    for (const reference of references) visit(reference);
    active.pop();
  }
  const entry = join(root, 'tsconfig.json');
  if (system.fileExists(entry)) visit(entry);
  else {
    // Observe absence too: creation during the check must not be silently accepted.
    system.readFile(entry);
    projects.set(entry, { file: entry, references: [], generated: false, parsed: ts.parseJsonConfigFileContent({ compilerOptions: {
      target: 'ES2023', module: 'ESNext', moduleResolution: 'Bundler', jsx: 'react-jsx',
      lib: ['ES2023', 'DOM', 'DOM.Iterable'], strict: true, skipLibCheck: true,
    }, include: ['src/**/*'] }, system, root, undefined, entry) });
  }
  const solution = [...projects.values()].some(project => project.references.length > 0);
  let owner: CheckProject | undefined;
  if (options.generatedProject !== undefined) {
    if (isAbsolute(options.generatedProject)) throw new CormiError('TYPECHECK_PROJECT_INVALID', 'generatedProject must be project-relative.');
    owner = projects.get(filename(options.generatedProject));
    if (!owner) throw new CormiError('TYPECHECK_PROJECT_INVALID', 'generatedProject must belong to the root tsconfig reference graph.');
  } else if (required.length) {
    const candidates = [...projects.values()].filter(project => project.parsed.fileNames.includes(required[0]!));
    if (candidates.length === 1) owner = candidates[0];
    else if (!candidates.length && (!solution || projects.get(entry)?.parsed.fileNames.length)) owner = projects.get(entry);
    else if (!fatal.length) throw new CormiError('TYPECHECK_GENERATED_PROJECT_REQUIRED', 'Set generatedProject in the TypeScript plugin options when generated roots have no unique owning project.', { candidates: candidates.map(project => local(project.file)) });
  }
  if (owner && required.length) {
    owner.generated = true;
    owner.parsed.fileNames = [...new Set([...owner.parsed.fileNames, ...required])];
    owner.parsed.errors = owner.parsed.errors.filter(error => error.code !== 18003);
  }
  return { entry, projects, fatal, solution, local };
}
