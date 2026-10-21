import { CormiError, type Plugin } from '@cormijs/core';
import { lstat, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type {} from '@cormijs/plugin-vite';

export interface MpaPluginOptions {
  readonly id?: string;
  /** Project-relative directory whose direct child directories become pages; default `src/pages`. */
  readonly directory?: string;
  /** Fallback element id for generated entries; default `root`. */
  readonly mountElementId?: string;
}
export interface MpaCandidate {
  readonly name: string;
  /** Project-relative POSIX path of the page entry. */
  readonly file: string;
  readonly title?: string;
  readonly mountElementId?: string;
}
export interface MpaEntry extends Required<Pick<MpaCandidate, 'name' | 'file' | 'title' | 'mountElementId'>> {
  /** Generated HTML, project-relative. */
  readonly html: string;
  /** Generated React entry, project-relative. */
  readonly entry: string;
}

const namePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const mountPattern = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const extensionPattern = /\.(?:tsx|jsx|ts|js)$/;
const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const posix = (value: string) => value.split(sep).join('/');

function normalizeOptions(options: MpaPluginOptions = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'directory', 'mountElementId'].includes(key))) {
    throw new CormiError('MPA_INVALID', 'Invalid MPA plugin options.');
  }
  const id = options.id ?? 'cormi:mpa';
  if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('MPA_INVALID', 'Invalid MPA plugin id.');
  const directory = (options.directory ?? 'src/pages').replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!directory || isAbsolute(directory) || directory.split('/').some(part => !part || part === '..' || part === 'node_modules' || part === '.cormi')) {
    throw new CormiError('MPA_INVALID', 'MPA directory must be project-relative.', { directory });
  }
  const mountElementId = options.mountElementId ?? 'root';
  if (typeof mountElementId !== 'string' || !mountPattern.test(mountElementId)) throw new CormiError('MPA_INVALID', 'Invalid mount element id.', { mountElementId });
  return { id, directory, mountElementId };
}

/** Validate/canonicalize discovered page directories; index is reserved for the SPA shell. */
export function resolveMpaEntries(candidates: readonly MpaCandidate[], options: Pick<Required<MpaPluginOptions>, 'directory' | 'mountElementId'>): readonly MpaEntry[] {
  if (!Array.isArray(candidates) || candidates.length > 32) throw new CormiError('MPA_INVALID', 'MPA supports 1 to 32 page directories.');
  const base = options.directory.replace(/\/+$/, '');
  const names = new Set<string>(), entries: MpaEntry[] = [];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') throw new CormiError('MPA_INVALID', 'Invalid MPA candidate.');
    const name = candidate.name;
    if (typeof name !== 'string' || !namePattern.test(name) || name.startsWith('_') || name === 'index') throw new CormiError('MPA_INVALID', 'MPA page names must be safe, non-index directory names.', { name });
    if (names.has(name)) throw new CormiError('MPA_INVALID', 'Duplicate MPA page name.', { name });
    const file = posix(String(candidate.file ?? ''));
    if (!extensionPattern.test(file) || isAbsolute(file) || file.split('/').includes('..') || !file.startsWith(base + '/')) {
      throw new CormiError('MPA_INVALID', 'MPA page entry must be inside the pages directory.', { file });
    }
    const title = candidate.title ?? name;
    if (typeof title !== 'string' || !title || title.length > 512 || /[\0\r\n]/.test(title)) throw new CormiError('MPA_INVALID', 'MPA title must be bounded text.', { name });
    const mountElementId = candidate.mountElementId ?? options.mountElementId;
    if (typeof mountElementId !== 'string' || !mountPattern.test(mountElementId)) throw new CormiError('MPA_INVALID', 'Invalid mount element id.', { name });
    names.add(name);
    const root = `.cormi/mpa/${name}`;
    entries.push(Object.freeze({ name, file, title, mountElementId, html: `${root}.html`, entry: `${root}.tsx` }));
  }
  return Object.freeze(entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)));
}

/** Standalone React mount; MPA pages deliberately do not construct the SPA router or providers. */
export function mpaEntrySource(entry: MpaEntry): string {
  return `import { createRoot } from 'react-dom/client';
import Page from '/${entry.file}';
const container = document.getElementById(${JSON.stringify(entry.mountElementId)});
if (!container) throw new Error(${JSON.stringify(`MPA_MOUNT_MISSING: #${entry.mountElementId}`)});
createRoot(container).render(<Page />);
`;
}

export function mpaHtml(entry: MpaEntry): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="icon" href="data:," />
<title>${escape(entry.title)}</title>
</head>
<body>
<div id="${escape(entry.mountElementId)}"></div>
<script type="module" src="/${entry.entry}"></script>
</body>
</html>
`;
}

async function discover(root: string, directory: string, mount: string): Promise<readonly MpaEntry[]> {
  const pages = join(root, directory);
  const items = await readdir(pages, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const candidates: MpaCandidate[] = [];
  for (const item of items.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!item.isDirectory() || item.name.startsWith('.') || item.name.startsWith('_') || item.name === 'node_modules') continue;
    const dir = join(pages, item.name);
    if ((await lstat(dir)).isSymbolicLink()) continue;
    const files = await readdir(dir, { withFileTypes: true });
    const index = ['index.tsx', 'index.jsx', 'index.ts', 'index.js']
      .map(name => files.find(file => file.isFile() && file.name === name))
      .find(Boolean);
    if (!index) continue;
    const file = join(dir, index.name);
    if ((await stat(file)).size > 1024 * 1024) throw new CormiError('MPA_INVALID', 'MPA page entry exceeds 1 MiB.', { file: posix(relative(root, file)) });
    let config: Record<string, unknown> = {};
    const configFile = join(dir, 'config.json');
    try {
      const info = await lstat(configFile);
      if (!info.isFile() || info.isSymbolicLink()) throw new CormiError('MPA_INVALID', 'MPA config.json must be a regular file.', { file: posix(relative(root, configFile)) });
      if (info.size > 64 * 1024) throw new CormiError('MPA_INVALID', 'MPA config.json exceeds 64 KiB.', { file: posix(relative(root, configFile)) });
      const parsed: unknown = JSON.parse(await readFile(configFile, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new CormiError('MPA_INVALID', 'MPA config.json must be an object.', { file: posix(relative(root, configFile)) });
      config = parsed as Record<string, unknown>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const title = config.title, mountElementId = config.mountElementId;
    candidates.push({
      name: item.name, file: posix(relative(root, file)),
      ...(title !== undefined ? { title: title as string } : {}),
      ...(mountElementId !== undefined ? { mountElementId: mountElementId as string } : {}),
    });
  }
  return resolveMpaEntries(candidates, { directory, mountElementId: mount });
}

/** Opt-in MPA: top-level page directories become standalone `<name>.html` entries. */
export const mpaPlugin: Plugin.Object<MpaPluginOptions> = {
  name: 'cormi:mpa', inject: ['vite', 'projectRoot'],
  apply(ctx, options) {
    const { id, directory, mountElementId } = normalizeOptions(options);
    const root = ctx.projectRoot.root;
    const generated = join(root, '.cormi/mpa');
    let entries: readonly MpaEntry[] = [];
    ctx.effect(() => async () => { await rm(generated, { recursive: true, force: true }); });
    ctx.effect(() => ctx.vite.add(id, () => {
      let output = '', building = false;
      const byName = () => new Map(entries.map(entry => [entry.name, entry]));
      return {
        name: id,
        async config(_config, env) {
          entries = await discover(root, directory, mountElementId);
          await rm(generated, { recursive: true, force: true });
          await mkdir(generated, { recursive: true });
          for (const entry of entries) {
            const file = join(root, entry.entry);
            if (!(await stat(join(root, entry.file))).isFile()) throw new CormiError('MPA_INVALID', 'MPA entry is unreadable.', { file: entry.file });
            await writeFile(file, mpaEntrySource(entry));
            await writeFile(join(root, entry.html), mpaHtml(entry));
          }
          if (env.command !== 'build' || !entries.length) return {};
          return { build: { rollupOptions: { input: {
            index: resolve(root, 'index.html'),
            ...Object.fromEntries(entries.map(entry => [entry.name, resolve(root, entry.html)])),
          } } } };
        },
        configResolved(config) { output = config.build.outDir; building = config.command === 'build'; },
        configureServer(server) {
          const base = server.config.base === '/' ? '' : server.config.base.replace(/\/$/, '');
          server.middlewares.use((request, _response, next) => {
            const url = new URL(request.url ?? '/', 'http://localhost');
            let pathname = url.pathname;
            if (base && (pathname === base || pathname.startsWith(base + '/'))) pathname = pathname.slice(base.length) || '/';
            const name = /^\/([^/]+)\.html$/.exec(pathname)?.[1];
            const entry = name ? byName().get(name) : undefined;
            if (entry) request.url = `${base}/${entry.html}${url.search}`;
            next();
          });
        },
        async closeBundle() {
          if (!building || !output || !entries.length) return;
          for (const entry of entries) {
            const source = join(output, entry.html);
            const target = join(output, `${entry.name}.html`);
            try { await lstat(target); throw new CormiError('MPA_OUTPUT_CONFLICT', 'MPA output page already exists.', { page: entry.name }); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
            await rename(source, target);
          }
          await rm(join(output, '.cormi/mpa'), { recursive: true, force: true });
        },
      };
    }));
  },
};
