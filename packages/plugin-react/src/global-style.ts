import { CormiError, type Plugin } from '@cormijs/core';
import { projectPath } from '@cormijs/routes';
import { lstat } from 'node:fs/promises';
import { extname } from 'node:path';
import type {} from './index.js';

export interface StyleContribution {
  readonly id: string;
  readonly files: readonly string[];
}
export interface GlobalStylePlan {
  readonly owner: string;
  /** Project-relative stylesheet path, e.g. `src/global.css`. */
  readonly file: string;
  readonly extension: string;
}
export const DEFAULT_STYLE_FILES = Object.freeze(['src/global.css', 'src/global.scss', 'src/global.sass', 'src/global.less']);
const stylePattern = /\.(css|scss|sass|less)$/;

function styleFiles(value: unknown): readonly string[] {
  if (!Array.isArray(value) || !value.length || value.length > 16 || value.some(file =>
    typeof file !== 'string' || !file || file.length > 512 || /[\0\r\n?#%\\]/.test(file) || file.startsWith('/')
    || !stylePattern.test(file) || file.split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')))) {
    throw new CormiError('STYLE_INVALID', 'Global style files must be project-relative stylesheets.');
  }
  return Object.freeze([...(value as string[])]);
}

export function styleContributions(input: unknown): readonly StyleContribution[] {
  if (!Array.isArray(input) || input.length > 8) throw new CormiError('STYLE_INVALID', 'Expected at most 8 global style contributions.');
  const ids = new Set<string>();
  return Object.freeze(input.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CormiError('STYLE_INVALID', 'Expected a global style contribution.');
    const item = raw as Record<string, unknown>;
    if (Object.keys(item).some(key => !['id', 'files'].includes(key)) || typeof item.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(item.id) || ids.has(item.id)) {
      throw new CormiError('STYLE_INVALID', 'Invalid or duplicate global style contribution id.');
    }
    ids.add(item.id);
    return Object.freeze({ id: item.id, files: styleFiles(item.files) });
  }));
}

export function styleFilesToWatch(sources: readonly StyleContribution[]): string[] {
  return sources.flatMap(source => source.files);
}

/** Each contribution picks its first existing candidate; contributions stack in hook order so the cascade stays explicit. */
export async function resolveGlobalStyles(root: string, sources: readonly StyleContribution[]): Promise<readonly GlobalStylePlan[]> {
  const plans: GlobalStylePlan[] = [], taken = new Set<string>();
  for (const source of sources) {
    for (const file of source.files) {
      let info;
      try { info = await lstat(projectPath(root, file)); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
      if (!info.isFile() || info.isSymbolicLink()) throw new CormiError('STYLE_INVALID', 'Global style file must be an ordinary file.', { file });
      const key = file.toLowerCase();
      if (taken.has(key)) throw new CormiError('STYLE_CONFLICT', 'A global style file cannot be contributed twice.', { file });
      taken.add(key);
      plans.push(Object.freeze({ owner: source.id, file, extension: extname(file).slice(1) }));
      break;
    }
  }
  return Object.freeze(plans);
}

export interface GlobalStylePluginOptions {
  readonly id?: string;
  readonly files?: readonly string[];
}
/** Opt-in convention: one global stylesheet per contribution, imported by the generated browser entry. */
export const globalStylePlugin: Plugin.Object<GlobalStylePluginOptions> = {
  name: 'cormi:global-style', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'files'].includes(key))) {
      throw new CormiError('STYLE_INVALID', 'Invalid global style plugin options.');
    }
    const id = options.id ?? 'cormi:global-style';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('STYLE_INVALID', 'Invalid global style id.');
    const contribution = styleContributions([{ id, files: options.files ?? DEFAULT_STYLE_FILES }])[0]!;
    ctx.effect(() => ctx.react.styles.tap({ id: id + ':styles', owner: id, ownerOrder: 0, run: () => [contribution] }));
  },
};
