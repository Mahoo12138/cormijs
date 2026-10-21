import { CormiError, type Plugin } from '@cormijs/core';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import type {} from './index.js';

export interface GenerateTemplate { readonly path: string; readonly content: string }
export interface GeneratorPluginOptions { readonly id?: string; readonly templates?: Readonly<Record<string, GenerateTemplate>> }
export interface PlannedFile { readonly path: string; readonly content: string }

const namePattern = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const pascal = (name: string) => name.split('-').filter(Boolean).map(part => part[0]!.toUpperCase() + part.slice(1)).join('');
const kebab = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();

const builtin: Record<string, (name: string) => PlannedFile> = {
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
  api: name => ({
    path: `src/api/${kebab(name)}.ts`,
    content: `export default function handler(request: Request) {\n  return Response.json({ ok: true, method: request.method });\n}\n`,
  }),
  mock: name => ({
    path: `mock/${kebab(name)}.ts`,
    content: `export default {\n  'GET /api/${kebab(name)}': () => ({ ok: true }),\n};\n`,
  }),
};

function assertTemplatePath(path: string): void {
  const parts = path.split('/');
  if (!path || path.startsWith('/') || path.startsWith('\\') || path.includes('\\') || path.includes('\0') || /[\r\n]/.test(path)
    || parts.some(part => !part || part === '..' || part === '.' || part === 'node_modules' || part === '.git' || part === '.cormi')
    || parts[parts.length - 1]!.startsWith('.env') || parts[parts.length - 1] === 'cormi.config.ts') {
    throw new CormiError('GENERATE_INVALID', 'Custom template paths must stay in project source locations.', { path });
  }
}

function customFile(template: GenerateTemplate, name: string): PlannedFile {
  const values = { name, kebab: kebab(name), pascal: pascal(name) };
  const replace = (value: string) => value.replace(/\{\{(name|kebab|pascal)\}\}/g, (_match, key: keyof typeof values) => values[key]);
  const path = replace(template.path), content = replace(template.content);
  assertTemplatePath(path);
  return { path, content };
}

export interface GeneratePlan {
  readonly kind: string;
  readonly name: string;
  readonly force: boolean;
  readonly dryRun: boolean;
  readonly files: readonly PlannedFile[];
}

/** Validates plugin-contributed templates once per plugin activation. */
export function normalizeTemplates(input: unknown): Readonly<Record<string, GenerateTemplate>> {
  if (input === undefined) return Object.freeze({});
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CormiError('GENERATE_INVALID', 'templates must be an object.');
  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > 16) throw new CormiError('GENERATE_INVALID', 'templates supports at most 16 entries.');
  const result: Record<string, GenerateTemplate> = {};
  for (const [kind, value] of entries) {
    if (!/^[A-Za-z][A-Za-z0-9-]{0,31}$/.test(kind) || kind in builtin) throw new CormiError('GENERATE_INVALID', 'Custom template names must be safe and must not shadow built-ins.', { kind });
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['path', 'content'].includes(key))) {
      throw new CormiError('GENERATE_INVALID', 'Custom templates need path and content strings.', { kind });
    }
    const row = value as Record<string, unknown>;
    if (typeof row.path !== 'string' || !row.path || row.path.length > 256 || /[\0\r\n]/.test(row.path)
      || typeof row.content !== 'string' || !row.content || row.content.length > 64 * 1024 || /\0/.test(row.content)) {
      throw new CormiError('GENERATE_INVALID', 'Custom template path/content is invalid or too large.', { kind });
    }
    assertTemplatePath(row.path);
    result[kind] = Object.freeze({ path: row.path, content: row.content });
  }
  return Object.freeze(result);
}

/** Grammar: `generate <kind> <name> [--force] [--dry-run]`; custom kinds are supplied by the plugin. */
export function planGeneration(positionals: readonly string[], custom: Readonly<Record<string, GenerateTemplate>> = {}): GeneratePlan {
  if (!Array.isArray(positionals) || positionals.length < 2) throw new CormiError('GENERATE_INVALID', 'Usage: generate <kind> <name> [--force] [--dry-run]');
  const flagList = positionals.slice(2);
  if (flagList.some(flag => flag !== '--force' && flag !== '--dry-run') || new Set(flagList).size !== flagList.length) {
    throw new CormiError('GENERATE_INVALID', 'Unknown or repeated generate flag; supported flags are --force and --dry-run.', { flags: flagList });
  }
  const flags = new Set(flagList);
  const [kind, name] = positionals as [string, string];
  if (!namePattern.test(name)) throw new CormiError('GENERATE_INVALID', 'The generated name must start with a letter and contain only letters, digits or dashes.', { name });
  const template = builtin[kind] ? builtin[kind]!(name) : custom[kind] ? customFile(custom[kind]!, name) : undefined;
  if (!template) throw new CormiError('GENERATE_INVALID', `Unknown generator kind: ${kind}`, { kinds: [...Object.keys(builtin), ...Object.keys(custom)].sort() });
  return Object.freeze({ kind, name, force: flags.has('--force'), dryRun: flags.has('--dry-run'), files: Object.freeze([template]) });
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

/** Opt-in project generator: creates page, component, model, API and mock source files. */
export const generatorPlugin: Plugin.Object<GeneratorPluginOptions> = {
  name: 'cormi:generator', inject: ['commands', 'projectRoot'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'templates'].includes(key))) {
      throw new CormiError('GENERATE_INVALID', 'Invalid generator plugin options.');
    }
    const id = options.id ?? 'cormi:generator';
    const templates = normalizeTemplates(options.templates);
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('GENERATE_INVALID', 'Invalid generator id.');
    ctx.effect(() => ctx.commands.register('generate', async request => {
      request.signal.throwIfAborted();
      const plan = planGeneration(request.positionals ?? [], templates);
      const created = await applyGeneration(ctx.projectRoot.root, plan);
      return { kind: 'result', data: Object.freeze({ kind: plan.kind, name: plan.name, dryRun: plan.dryRun, files: created }) };
    }));
  },
};
