import { assertActive, CormiError, type Context, type Plugin as CordisPlugin } from '@cormijs/core';
import type { Builder, BuildPlan, BuildResult, ServerHandle } from '@cormijs/builder';
import { build as viteBuild, createServer, preview as vitePreview,
  type InlineConfig, type PluginOption, type PreviewServer, type ViteDevServer } from 'vite';
import { mkdir, mkdtemp, realpath, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';

export interface ViteExtensions {
  /** Create fresh native plugins per session. Bind the returned unregister to the contributor's ctx.effect. */
  add(id: string, create: () => PluginOption, order?: number): () => void;
  ids(): readonly string[];
}

declare module 'cordis' { interface Context { vite: ViteExtensions } }

type NativeServer = ViteDevServer | PreviewServer;

async function validatePlan(plan: BuildPlan, preview: boolean): Promise<{ root: string; output: string }> {
  if (!isAbsolute(plan.root)) throw new CormiError('ROOT_INVALID', 'BuildPlan.root must be absolute.');
  const root = await realpath(plan.root);
  if (plan.entry !== 'index.html') throw new CormiError('ENTRY_UNSUPPORTED', 'P0 supports index.html only.');
  const output = resolve(root, plan.outDir);
  // P0 deliberately only supports direct child output directories, never overwrites them.
  if (dirname(output) !== root || ['node_modules', '.git', 'src', 'public', '.cormi', '.cormi.lock'].includes(basename(output))) {
    throw new CormiError('OUTPUT_PATH_INVALID', 'Output must be a dedicated direct child of the project.', { output });
  }
  if (!plan.base.startsWith('/') || !plan.base.endsWith('/') || plan.base.startsWith('//')
    || plan.base.includes('\\') || plan.base.split('/').includes('..')) throw new CormiError('BASE_INVALID', 'base must be an absolute URL path ending with /.');
  const port = plan.server?.port;
  if (port !== undefined && (!Number.isInteger(port) || port < 0 || port > 65535)) throw new CormiError('PORT_INVALID', 'Invalid port.');
  const entry = await realpath(join(preview ? output : root, plan.entry));
  if (!entry.startsWith((preview ? output : root) + sep) || !(await stat(entry)).isFile()) {
    throw new CormiError('ENTRY_INVALID', 'Entry must be a file inside the project output/source.');
  }
  return { root, output };
}

/** Vite is a Cordis provider, not a dependency of the host or Web consumer. */
export const vitePlugin: CordisPlugin.Object<void> = {
  name: 'cormi:vite',
  apply: (ctx: Context) => {
    const lifetime = new AbortController();
    const pending = new Set<Promise<unknown>>();
    const sessions = new Set<ServerHandle>();
    const cleanupErrors: unknown[] = [];
    const extensions = new Map<string, { create: () => PluginOption; order: number }>();
    const ordered = () => [...extensions].sort(([a, x], [b, y]) => x.order - y.order || (a < b ? -1 : a > b ? 1 : 0));

    const native: ViteExtensions = {
      add(id, create, order = 0) {
        assertActive(ctx);
        if (!id || extensions.has(id)) throw new CormiError('VITE_PLUGIN_CONFLICT', `Duplicate native plugin: ${id}`);
        if (!Number.isFinite(order)) throw new TypeError('Invalid native plugin order');
        const entry = { create, order };
        extensions.set(id, entry);
        return () => { if (extensions.get(id) === entry) extensions.delete(id); };
      },
      ids: () => ordered().map(([id]) => id),
    };

    function own(server: NativeServer, cache: string): ServerHandle {
      const url = server.resolvedUrls?.local[0] ?? server.resolvedUrls?.network[0];
      if (!url) throw new CormiError('SERVER_ADDRESS_MISSING', 'Server did not report a listening URL.');
      let closing: Promise<void> | undefined;
      const handle: ServerHandle = Object.freeze({
        url,
        close() {
          if (closing) return closing;
          closing = (async () => {
            try {
              await server.close();
            } finally {
              await rm(cache, { recursive: true, force: true });
              sessions.delete(handle);
            }
          })();
          // Preserve cleanup errors even when the caller already observed the rejection.
          closing.catch(error => { cleanupErrors.push(error); });
          return closing;
        },
      });
      sessions.add(handle);
      return handle;
    }

    async function run<T>(operation: (signal: AbortSignal) => Promise<T>, external?: AbortSignal,
      release?: (value: T) => Promise<void>): Promise<T> {
      assertActive(ctx);
      const signal = external ? AbortSignal.any([external, lifetime.signal]) : lifetime.signal;
      signal.throwIfAborted();
      const task = (async () => {
        const value = await operation(signal);
        if (signal.aborted && release) await release(value);
        signal.throwIfAborted();
        return value;
      })();
      pending.add(task);
      task.then(() => pending.delete(task), () => pending.delete(task));
      return task;
    }

    async function configuration(plan: BuildPlan, forPreview: boolean,
      capture: (server: NativeServer) => void): Promise<{ config: InlineConfig; cache: string; output: string }> {
      const { root, output } = await validatePlan(plan, forPreview);
      // Factory snapshot taken before creating the Vite session; caller order is explicit.
      const plugins = ordered().map(([, entry]) => entry.create());
      const cache = await mkdtemp(join(root, '.cormi-vite-'));
      const config: InlineConfig = {
        root, configFile: false, envFile: false, envPrefix: 'CORMI_PUBLIC_', cacheDir: cache,
        base: plan.base, mode: plan.mode, logLevel: 'silent', clearScreen: false,
        server: { host: plan.server?.host ?? '127.0.0.1', port: plan.server?.port ?? 0,
          strictPort: true, open: false, fs: { strict: true, allow: [root],
            deny: ['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**',
              '**/.cormi/run-*/**', '**/.cormi.lock/**', '**/cormi.config.*',
              ...(plan.serverOnlyFiles ?? []).map(file => file.split(sep).join('/').replace(/[?*\[\]{}()!+@]/g, '\\$&'))],
          } },
        preview: { host: plan.server?.host ?? '127.0.0.1', port: plan.server?.port ?? 0, strictPort: true, open: false },
        build: { outDir: output, emptyOutDir: false, write: true, watch: null },
        optimizeDeps: { noDiscovery: true, include: [] },
        plugins: [{
          name: 'cormi:session-owner', enforce: 'pre',
          configureServer(server) { capture(server); },
          configurePreviewServer(server) { capture(server); },
          configResolved(resolved) {
            if (resolve(resolved.root) !== root || resolve(resolved.build.outDir) !== output
              || resolved.build.emptyOutDir || resolved.build.watch || resolve(resolved.cacheDir) !== cache) {
              throw new CormiError('VITE_RESERVED_CONFIG', 'Native plugin changed framework-owned paths or build mode.');
            }
          },
        }, ...plugins],
      };
      return { config, cache, output };
    }

    async function open(plan: BuildPlan, isPreview: boolean, signal: AbortSignal): Promise<ServerHandle> {
      let server: NativeServer | undefined;
      const { config, cache } = await configuration(plan, isPreview, value => { server = value; });
      try {
        signal.throwIfAborted();
        if (isPreview) server = await vitePreview(config);
        else {
          const dev = await createServer(config);
          server = dev;
          await dev.listen();
        }
        return own(server, cache);
      } catch (error) {
        if (server) {
          try {
            await server.close();
          } catch (cleanup) { cleanupErrors.push(cleanup); }
        }
        await rm(cache, { recursive: true, force: true });
        throw error;
      }
    }

    const builder: Builder = {
      name: 'vite',
      dev: (plan, signal) => run(s => open(plan, false, s), signal, handle => handle.close()),
      preview: (plan, signal) => run(s => open(plan, true, s), signal, handle => handle.close()),
      build: (plan, signal) => run(async s => {
        const { config, cache, output } = await configuration(plan, false, () => {});
        try {
          s.throwIfAborted();
          // Exclusive mkdir is also the admission fence between racing build calls.
          try { await mkdir(output); }
          catch (cause) { throw new CormiError('OUTPUT_NOT_FRESH', 'P0 never overwrites an existing output directory.', { output }, { cause }); }
          await viteBuild(config);
          return { backend: 'vite', outDir: output } satisfies BuildResult;
        } finally { await rm(cache, { recursive: true, force: true }); }
      }, signal),
    };
    ctx.provide('builder', builder);
    ctx.provide('vite', native);
    ctx.effect(() => async () => {
      lifetime.abort(new CormiError('PLUGIN_INACTIVE', 'Vite provider was unloaded.'));
      await Promise.allSettled([...pending]);
      const results = await Promise.allSettled([...sessions].map(handle => handle.close()));
      for (const result of results) if (result.status === 'rejected') cleanupErrors.push(result.reason);
      if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Vite cleanup failed');
    });
  },
};
