import { CormiError, type Plugin } from '@cormijs/core';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import type {} from './index.js';

export interface GeneratorPluginOptions { readonly id?: string }
export interface PlannedFile { readonly path: string; readonly content: string }

const namePattern = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const pascal = (name: string) => name.split('-').filter(Boolean).map(part => part[0]!.toUpperCase() + part.slice(1)).join('');
const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const templates: Record<string, (name: string) => PlannedFile> = {
  page: name => ({
    path: `src/pages/${kebab(name)}.tsx`,
    content: `export default function ${pascal(name)}Page() {\n  return <main><h1>${pascal(name)}</h1></main>;\n}\n`,
  }),
  component: name => ({
    path: `src/components/${pascal(name)}/index.tsx`,
    content: `export interface ${pascal(name)}Props { readonly title?: string }\n\nexport default function ${pascal(name)}({ title = '${pascal(name)}' }: ${pascal(name)}Props) {\n  return <section><h2>{title}</h2></section>;\n}\n`,
  }),
  model: name => ({
    path: `src/models/${kebab(name)}.ts`,
    content: `import { useState } from 'react';\n\nexport default function use${pascal(name)}() {\n  const [value, setValue] = useState<string | undefined>();\n  return { value, setValue };\n}\n`,
  }),
};

export interface GeneratePlan {
  readonly kind: string;
  readonly name: string;
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly files: readonly PlannedFile[];
}

/** Grammar: `generate <page|component|model> <name> [--force] [--dry-run]`. */
export function planGeneration(positionals: readonly string[]): GeneratePlan {
  if (!Array.isArray(positionals) || positionals.length < 2) throw new CormiError('GENERATE_INVALID', 'Usage: generate <page|component|model> <name> [--force] [--dry-run]');
  const flagList = positionals.slice(2);
  if (flagList.some(flag => flag !== '--force' && flag !== '--dry-run') || new Set(flagList).size !== flagList.length) {
    throw new CormiError('GENERATE_INVALID', 'Unknown or repeated generate flag; supported flags are --force and --dry-run.', { flags: flagList });
  }
  const flags = new Set(flagList);
  const [kind, name] = positionals as [string, string];
  const template = templates[kind];
  if (!template) throw new CormiError('GENERATE_INVALID', `Unknown generator kind: ${kind}`, { kinds: Object.keys(templates).sort() });
  if (!namePattern.test(name)) throw new CormiError('GENERATE_INVALID', 'The generated name must start with a letter and contain only letters, digits or dashes.', { name });
  return Object.freeze({ kind, name, force: flags.has('--force'), dryRun: flags.has('--dry-run'), files: Object.freeze([template(name)]) });
}

/** Writes are project-relative and never overwrite without --force; existing files fail before any write. */
export async function applyGeneration(root: string, plan: GeneratePlan): Promise<readonly string[]> {
  const targets = plan.files.map(file => {
    const target = join(root, file.path), local = relative(root, target);
    if (!local || isAbsolute(local) || local === '..' || local.startsWith('..' + sep)) throw new CormiError('GENERATE_INVALID', 'Generated paths must stay inside the project.', { path: file.path });
    return { ...file, target };
  });
  if (!plan.dryRun) {
    for (const file of targets) {
      await mkdir(dirname(file.target), { recursive: true });
      try { await writeFile(file.target, file.content, { flag: plan.force ? 'w' : 'wx' }); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new CormiError('GENERATE_EXISTS', 'The target already exists; pass --force to overwrite.', { path: file.path });
        throw error;
      }
    }
  }
  return Object.freeze(targets.map(file => file.path));
}

/** Opt-in project generator: creates page, component and model source files from built-in templates. */
export const generatorPlugin: Plugin.Object<GeneratorPluginOptions> = {
  name: 'cormi:generator', inject: ['commands', 'projectRoot'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'id')) {
      throw new CormiError('GENERATE_INVALID', 'Invalid generator plugin options.');
    }
    const id = options.id ?? 'cormi:generator';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('GENERATE_INVALID', 'Invalid generator id.');
    ctx.effect(() => ctx.commands.register('generate', async request => {
      request.signal.throwIfAborted();
      const plan = planGeneration(request.positionals ?? []);
      const created = await applyGeneration(ctx.projectRoot.root, plan);
      return { kind: 'result', data: Object.freeze({ kind: plan.kind, name: plan.name, dryRun: plan.dryRun, files: created }) };
    }));
  },
};
