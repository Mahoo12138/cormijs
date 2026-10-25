import { CormiError, type Plugin } from '@cormijs/core';
import react from '@vitejs/plugin-react';
import { rm, stat, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { build as viteBuild, type ResolvedConfig } from 'vite';
import type {} from '@cormijs/plugin-vite';

export interface QiankunPluginOptions {
  readonly id?: string;
  /** UMD global; qiankun reads this object as the sub-app lifecycles. */
  readonly name?: string;
  /** Mount element created inside the qiankun container. */
  readonly mountId?: string;
}

function entrySource(mountId: string): string {
  return `import { createMicroApp } from '@cormijs/runtime/microfrontend';
import type { MicroAppProps } from '@cormijs/runtime/microfrontend';
(globalThis as { __CORMI_MICRO_APP__?: boolean }).__CORMI_MICRO_APP__ = true;
let lifecycle: ReturnType<typeof createMicroApp> | undefined;
async function app() {
  if (!lifecycle) {
    const module = await import('./app');
    lifecycle = createMicroApp(module.cormiApplication, { mountId: ${JSON.stringify(mountId)} });
  }
  return lifecycle;
}
export async function bootstrap() { await (await app()).bootstrap(); }
export async function mount(props: MicroAppProps) { await (await app()).mount(props); }
export async function unmount() { await (await app()).unmount(); }
export async function update(props: MicroAppProps) { await (await app()).update(props); }
`;
}

/** Build a qiankun HTML/UMD entry beside the normal app build; dev keeps normal auto-mount. */
export const qiankunPlugin: Plugin.Object<QiankunPluginOptions> = {
  name: 'cormi:qiankun', inject: ['vite'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => !['id', 'name', 'mountId'].includes(key))) {
      throw new CormiError('QIANKUN_INVALID', 'Invalid qiankun plugin options.');
    }
    const id = options.id ?? 'cormi:qiankun';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('QIANKUN_INVALID', 'Invalid qiankun plugin id.');
    const name = options.name ?? 'CormiMicroApp';
    if (typeof name !== 'string' || !/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(name)) throw new CormiError('QIANKUN_INVALID', 'name must be a JavaScript global identifier.');
    const mountId = options.mountId ?? 'root';
    if (typeof mountId !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(mountId)) throw new CormiError('QIANKUN_INVALID', 'Invalid qiankun mountId.');
    ctx.effect(() => ctx.vite.add(id, () => {
      let resolved: ResolvedConfig | undefined;
      const entryFile = () => resolved ? join(resolved.root, '.cormi', 'qiankun.ts') : '';
      return {
        name: id,
        configResolved(config) { resolved = config; },
        async closeBundle() {
          if (!resolved) return;
          if (resolved.command !== 'build') { await rm(entryFile(), { force: true }); return; }
          await mkdir(join(resolved.root, '.cormi'), { recursive: true });
          await writeFile(entryFile(), entrySource(mountId));
          try {
            await viteBuild({
              root: resolved.root, configFile: false, mode: resolved.mode, base: './',
              define: { ...resolved.define, 'process.env.NODE_ENV': JSON.stringify(resolved.mode === 'production' ? 'production' : 'development') },
              resolve: { alias: resolved.resolve.alias, dedupe: resolved.resolve.dedupe, extensions: resolved.resolve.extensions },
              publicDir: false, logLevel: 'silent', clearScreen: false, plugins: [react()],
              build: {
                outDir: resolved.build.outDir, emptyOutDir: false, copyPublicDir: false, write: true, cssCodeSplit: false, target: 'es2022',
                lib: { entry: entryFile(), name, formats: ['umd'], fileName: () => 'qiankun.js', cssFileName: 'qiankun' },
                rollupOptions: { output: { inlineDynamicImports: true, entryFileNames: 'qiankun.js', assetFileNames: 'qiankun.[ext]' } },
              },
            });
            const css = await stat(join(resolved.build.outDir, 'qiankun.css')).then(() => '<link rel="stylesheet" href="./qiankun.css" />').catch(() => '');
            await writeFile(join(resolved.build.outDir, 'qiankun.html'),
              `<!doctype html><html><head><meta charset="utf-8" /><link rel="icon" href="data:," />${css}</head><body><script src="./qiankun.js"></script></body></html>\n`);
          } catch (cause) {
            throw new CormiError('QIANKUN_BUILD_FAILED', 'The qiankun UMD entry could not be built.', {}, { cause });
          } finally {
            await rm(entryFile(), { force: true });
          }
        },
      };
    }));
  },
};
