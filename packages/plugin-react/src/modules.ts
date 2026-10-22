import { CormiError } from '@cormijs/core';
import { moduleRef, projectPath, type ModuleRef } from '@cormijs/routes';
import { realpath, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const isServerModule = (name: string): boolean => /^@cormijs\/plugin-[^/]+\/(?:runtime|pro-layout)$/.test(name) ? false
  : name === 'cormijs' || name.startsWith('cormijs/')
  || name === 'cordis' || name.startsWith('cordis/') || name.startsWith('@cordisjs/')
  || /^@cormijs\/(?:core|builder|routes|plugin-[^/]+|preset-[^/]+)(?:\/|$)/.test(name) || name.startsWith('node:');
const inside = (root: string, file: string) => {
  const local = relative(root, file);
  return !!local && local !== '..' && !local.startsWith('..' + sep) && !isAbsolute(local);
};
/** Author-side convenience; stores data, never imports or executes the client module. */
export function clientModule(specifier: string, from: string, exportName = 'default'): ModuleRef {
  return moduleRef({ specifier, from, exportName });
}
/** Lexical resolution also works for missing files, enabling development repair observation. */
export function clientModuleFile(root: string, input: ModuleRef): string | undefined {
  const ref = moduleRef(input);
  if (isServerModule(ref.specifier)) throw new CormiError('CLIENT_SERVER_IMPORT', 'Node SDK cannot be imported into a browser application.', { specifier: ref.specifier });
  if (!ref.specifier.startsWith('.')) return undefined;
  if (!ref.from) return projectPath(root, ref.specifier);
  const directory = dirname(fileURLToPath(ref.from));
  const file = resolve(directory, ref.specifier);
  if (!inside(directory, file)) throw new CormiError('CLIENT_MODULE_INVALID', 'An anchored browser reference cannot escape its declaring directory.');
  return file;
}
export async function clientSpecifier(root: string, input: ModuleRef, forbidden: ReadonlySet<string>): Promise<string> {
  const ref = moduleRef(input), file = clientModuleFile(root, ref);
  if (!file) return ref.specifier; // Bare imports retain the backend's browser/export conditions.
  const boundary = ref.from ? dirname(fileURLToPath(ref.from)) : root;
  if (ref.from) {
    const anchor = fileURLToPath(ref.from);
    if (await realpath(anchor) !== anchor || !(await stat(anchor)).isFile() || !/\.[cm]?[jt]sx?$/.test(anchor)) {
      throw new CormiError('CLIENT_MODULE_INVALID', 'The declaring module must be an existing canonical source file.');
    }
  }
  const actual = await realpath(file);
  if (actual !== file || !inside(boundary, actual) || forbidden.has(actual)
    || /(?:^|[\\/])(?:\.cormi(?:[\\/]|$)|\.cormi\.lock(?:[\\/]|$)|\.cormi-publish[^\\/]*|\.env(?:\.|[\\/]|$)|cormi\.config\.)/.test(actual)
    || /\.server\.[cm]?[jt]sx?$/.test(actual) || !/\.[cm]?[jt]sx?$/.test(actual) || !(await stat(actual)).isFile()) {
    throw new CormiError('CLIENT_MODULE_INVALID', 'Browser module must be a non-private, non-symlink source file.', { specifier: ref.specifier });
  }
  const local = relative(join(root, '.cormi'), actual).split(sep).join('/');
  if (isAbsolute(local)) throw new CormiError('CLIENT_MODULE_INVALID', 'Cross-volume browser modules are not supported.');
  return local.startsWith('.') ? local : './' + local;
}
/** Inspect identifies anchors without embedding machine-specific absolute file URLs. */
export function inspectModule(root: string, ref: ModuleRef): Readonly<Record<string, string>> {
  if (!ref.from) return { specifier: ref.specifier, exportName: ref.exportName };
  const anchor = fileURLToPath(ref.from), local = relative(root, anchor).split(sep).join('/');
  return { specifier: ref.specifier, exportName: ref.exportName,
    from: inside(root, anchor) ? 'project:' + local : 'external:' + basename(anchor) };
}
