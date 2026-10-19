import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { lstat, readFile, readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

/** Test-only byte inventory, not a cormi deployment command or production server. */
export async function siteFiles(directory: string): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>(); let bytes = 0;
  async function visit(path: string, prefix = ''): Promise<void> {
    for (const name of (await readdir(path)).sort()) {
      const full = join(path, name), local = prefix + name, info = await lstat(full);
      assert.ok(!info.isSymbolicLink(), 'Test site cannot contain links');
      if (info.isDirectory()) await visit(full, local + '/');
      else {
        assert.ok(info.isFile() && info.nlink === 1 && info.size <= 16 * 1024 * 1024, 'Expected bounded independent site files');
        const value = await readFile(full); bytes += value.length;
        assert.ok(files.size < 4096 && bytes <= 64 * 1024 * 1024, 'Test site budget exceeded'); files.set(local, value);
      }
    }
  }
  await visit(directory); return files;
}
export const siteMime: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2',
};
/** Reads only a deployment copy. No cormi, Vite, config, source or node_modules access. */
export async function serveStaticCopy(directory: string, base: string) {
  assert.ok(base.startsWith('/') && base.endsWith('/') && !base.includes('..'));
  const files = await siteFiles(directory); assert.ok(files.has('index.html'));
  const requests: Array<{ path: string; status: number }> = [];
  const server = createServer((req, res) => {
    let path: string;
    try { path = decodeURIComponent(new URL(req.url ?? '/', 'http://localhost').pathname); }
    catch { res.writeHead(400).end(); return; }
    const local = path.startsWith(base) ? path.slice(base.length) : undefined;
    let name: string | undefined;
    if (local !== undefined && !local.includes('\\') && !local.split('/').some(part => part.startsWith('.'))
      && !['api', 'node_modules', 'src', 'features'].includes(local.split('/')[0]!)) {
      if (!local) name = 'index.html';
      else if (files.has(local)) name = local;
      else if (!extname(local) && req.headers.accept?.includes('text/html')) name = 'index.html';
    }
    const status = req.method !== 'GET' && req.method !== 'HEAD' ? 405 : name ? 200 : 404;
    requests.push({ path, status });
    const body = status === 200 ? files.get(name!)! : Buffer.from('Not found');
    res.writeHead(status, { 'content-type': status === 200 ? siteMime[extname(name!)] ?? 'application/octet-stream' : 'text/plain',
      'content-length': body.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  return { url: `http://127.0.0.1:${address.port}${base}`, requests,
    async close() { await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); }); } };
}
