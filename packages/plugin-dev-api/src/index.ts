import { CormiError, deadline } from '@cormijs/core';
import { request as httpRequest, validateHeaderName, validateHeaderValue, type IncomingMessage, type ServerResponse, type OutgoingHttpHeaders } from 'node:http';
import { request as httpsRequest } from 'node:https';

export interface MockRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly body: unknown;
  readonly signal: AbortSignal;
}
export interface MockResponse { readonly status?: number; readonly headers?: Readonly<Record<string, string>>; readonly body?: unknown }
export interface MockRule { readonly method: string; readonly path: string; readonly handle: (request: MockRequest) => MockResponse | Promise<MockResponse> }
export interface ProxyRule { readonly path: string; readonly target: string; readonly stripPrefix?: boolean }
export interface DevApiOptions {
  readonly prefix?: string;
  readonly mocks?: readonly MockRule[];
  readonly proxies?: readonly ProxyRule[];
  readonly timeoutMs?: number;
  readonly maxBodyBytes?: number;
  readonly maxResponseBytes?: number;
  readonly maxConcurrent?: number;
}
interface Reply { status: number; headers: OutgoingHttpHeaders; body: Buffer; contentLength?: string }
class HttpFailure extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
const methods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + '/');
function validPath(value: unknown): value is string {
  return typeof value === 'string' && /^\/(?:[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*)?$/.test(value);
}
function fields(value: object, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new CormiError('DEV_API_CONFIG_INVALID', 'Unknown development API option.');
}
export function validateDevApi(input: DevApiOptions = {}): Required<DevApiOptions> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CormiError('DEV_API_CONFIG_INVALID', 'Expected development API options.');
  fields(input, ['prefix','mocks','proxies','timeoutMs','maxBodyBytes','maxResponseBytes','maxConcurrent']);
  const prefix = input.prefix ?? '/api', timeoutMs = input.timeoutMs ?? 10000;
  const maxConcurrent = input.maxConcurrent ?? 64;
  const maxBodyBytes = input.maxBodyBytes ?? 1024 * 1024, maxResponseBytes = input.maxResponseBytes ?? 4 * 1024 * 1024;
  if (!validPath(prefix) || prefix === '/' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000
    || !Number.isInteger(maxBodyBytes) || maxBodyBytes < 1 || maxBodyBytes > 16 * 1024 * 1024
    || !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 16 * 1024 * 1024
    || !Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 256
    || !Array.isArray(input.mocks ?? []) || !Array.isArray(input.proxies ?? [])
    || (input.mocks?.length ?? 0) + (input.proxies?.length ?? 0) > 256) throw new CormiError('DEV_API_CONFIG_INVALID', 'Invalid API namespace or request limits.');
  const keys = new Set<string>();
  const mocks = (input.mocks ?? []).map(rule => {
    if (!rule || !validPath(rule.path) || !methods.has(rule.method) || typeof rule.handle !== 'function') throw new CormiError('DEV_API_CONFIG_INVALID', 'Invalid mock rule.');
    fields(rule, ['method','path','handle']);
    const key = rule.method + ' ' + rule.path;
    if (keys.has(key)) throw new CormiError('DEV_API_RULE_CONFLICT', 'Duplicate mock method and path.');
    keys.add(key); return Object.freeze({ ...rule });
  });
  const paths = new Set<string>();
  const proxies = (input.proxies ?? []).map(rule => {
    if (!rule || !validPath(rule.path) || typeof rule.target !== 'string' || rule.stripPrefix !== undefined && typeof rule.stripPrefix !== 'boolean') throw new CormiError('DEV_API_CONFIG_INVALID', 'Invalid proxy rule.');
    fields(rule, ['path','target','stripPrefix']);
    let url: URL;
    try { url = new URL(rule.target); } catch { throw new CormiError('DEV_API_CONFIG_INVALID', 'Proxy target must be an HTTP origin or base URL.'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new CormiError('DEV_API_CONFIG_INVALID', 'Proxy target cannot contain credentials, search or fragment.');
    if (paths.has(rule.path)) throw new CormiError('DEV_API_RULE_CONFLICT', 'Duplicate proxy path.');
    paths.add(rule.path); return Object.freeze({ ...rule, target: url.href });
  }).sort((a,b) => b.path.length - a.path.length);
  return Object.freeze({ prefix, timeoutMs, maxBodyBytes, maxResponseBytes, maxConcurrent, mocks: Object.freeze(mocks), proxies: Object.freeze(proxies) });
}
const hopHeaders = new Set(['connection','keep-alive','proxy-authenticate','proxy-authorization','te','trailer','transfer-encoding','upgrade','host','content-length']);
function headers(input: IncomingMessage['headers'] | OutgoingHttpHeaders): OutgoingHttpHeaders {
  const connections = Object.entries(input).filter(([name]) => name.toLowerCase() === 'connection').map(([, value]) => String(value)).join(',');
  const omit = new Set([...hopHeaders, ...connections.toLowerCase().split(',').map(x => x.trim())]);
  const result: OutgoingHttpHeaders = Object.create(null);
  for (const [name, value] of Object.entries(input)) {
    if (value === undefined || omit.has(name.toLowerCase())) continue;
    validateHeaderName(name);
    for (const part of Array.isArray(value) ? value : [value]) validateHeaderValue(name, String(part));
    const key = name.toLowerCase();
    if (Object.hasOwn(result, key)) throw new TypeError('Duplicate response header name.');
    result[key] = value;
  }
  return result;
}
function collect(stream: IncomingMessage, limit: number, signal: AbortSignal, overflowStatus = 413): Promise<Buffer> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    let size = 0; const chunks: Buffer[] = [];
    const cleanup = () => { stream.off('data', data); stream.off('end', end); stream.off('error', fail); stream.off('aborted', aborted); signal.removeEventListener('abort', abort); };
    const fail = (error: unknown) => { cleanup(); stream.resume(); reject(error); };
    const abort = () => fail(signal.reason);
    const aborted = () => fail(new HttpFailure(400, 'REQUEST_ABORTED'));
    const data = (chunk: Buffer) => { size += chunk.length; if (size > limit) fail(new HttpFailure(overflowStatus, 'BODY_TOO_LARGE')); else chunks.push(chunk); };
    const end = () => { cleanup(); resolve(Buffer.concat(chunks)); };
    stream.on('data', data); stream.once('end', end); stream.once('error', fail); stream.once('aborted', aborted);
    signal.addEventListener('abort', abort, { once: true });
  });
}
function proxy(rule: ProxyRule, localPath: string, query: string, method: string, incoming: IncomingMessage['headers'], body: Buffer, signal: AbortSignal, limit: number): Promise<Reply> {
  const target = new URL(rule.target), suffix = rule.stripPrefix ? localPath.slice(rule.path === '/' ? 0 : rule.path.length) : localPath;
  target.pathname = target.pathname.replace(/\/$/, '') + '/' + suffix.replace(/^\//, ''); target.search = query;
  const outgoing = headers(incoming); outgoing.host = target.host; outgoing['content-length'] = body.length;
  return new Promise((resolve, reject) => {
    const request = (target.protocol === 'https:' ? httpsRequest : httpRequest)(target, { method, headers: outgoing, signal, agent: false }, response => {
      collect(response, limit, signal, 502).then(bytes => {
        const status = response.statusCode ?? 502;
        // HEAD/304 may describe a representation without transferring its bytes (RFC 9110 §8.6).
        const contentLength = status === 204 ? undefined : status === 205 ? '0'
          : method === 'HEAD' || status === 304 ? response.headers['content-length'] : String(bytes.length);
        resolve({ status, headers: headers(response.headers), contentLength,
          body: method === 'HEAD' || [204, 205, 304].includes(status) ? Buffer.alloc(0) : bytes });
      }).catch(error => { response.destroy(); reject(error); });
    });
    request.once('error', reject); request.end(body);
  });
}
/** A bounded development-only HTTP handler, not a production gateway or untrusted-code sandbox. */
export class DevApiSession {
  readonly options: Required<DevApiOptions>;
  private readonly active = new Set<AbortController>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly responses = new Set<Promise<void>>();
  private closing?: Promise<void>;
  constructor(options: DevApiOptions = {}) { this.options = validateDevApi(options); }
  summary() { return { prefix: this.options.prefix, mocks: this.options.mocks.map(({method,path})=>({method,path})), proxies: this.options.proxies.map(({path})=>({path})) }; }
  readonly middleware = (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const raw = req.url ?? '/', rawPath = raw.split('?')[0]!;
    if (this.closing || !under(rawPath, this.options.prefix)) { next(); return; }
    // One slot owns both the handler and its response, including slow writes and late handlers.
    if (this.active.size >= this.options.maxConcurrent) {
      const body = '{"error":"DEV_API_BUSY"}';
      res.writeHead(503, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', connection:'close', 'content-length':Buffer.byteLength(body) });
      res.end(req.method === 'HEAD' ? undefined : body); return;
    }
    const control = new AbortController(); this.active.add(control);
    let responseEnded = false, taskSettled = false, abort = () => {};
    const release = () => { if (responseEnded && taskSettled) this.active.delete(control); };
    let resolveResponse!: () => void;
    const responseDone = new Promise<void>(resolve => { resolveResponse = resolve; }); this.responses.add(responseDone);
    const timer = setTimeout(() => control.abort(new HttpFailure(504, 'DEV_API_TIMEOUT')), this.options.timeoutMs);
    const finish = () => {
      if (responseEnded) return;
      responseEnded = true; clearTimeout(timer);
      control.signal.removeEventListener('abort', abort); control.signal.removeEventListener('abort', interruptWrite);
      res.off('finish', finish); res.off('close', disconnected); res.off('error', writeError);
      this.responses.delete(responseDone); resolveResponse(); release();
    };
    const disconnected = () => {
      if (!res.writableFinished) control.abort(new HttpFailure(499, 'CLIENT_DISCONNECTED'));
      finish();
    };
    const interruptWrite = () => { if (res.headersSent && !res.writableFinished) res.destroy(); };
    const writeError = () => { control.abort(new HttpFailure(499, 'CLIENT_DISCONNECTED')); res.destroy(); };
    res.once('finish', finish); res.once('close', disconnected); res.once('error', writeError);
    control.signal.addEventListener('abort', interruptWrite, { once: true });
    const task = this.respond(req, raw, control.signal); this.pending.add(task);
    const settle = () => { this.pending.delete(task); taskSettled = true; release(); };
    task.then(settle, settle);
    const cancellation = new Promise<never>((_, reject) => { abort = () => reject(control.signal.reason); control.signal.addEventListener('abort', abort, { once: true }); });
    void Promise.race([task, cancellation]).then(reply => {
      if (!res.destroyed) {
        res.writeHead(reply.status, { ...reply.headers, ...(reply.contentLength !== undefined ? { 'content-length': reply.contentLength } : {}) });
        res.end(req.method === 'HEAD' ? undefined : reply.body);
      }
    }).catch((error: unknown) => {
      if (res.destroyed) return;
      // A response that already started cannot be replaced by JSON without corrupting its framing.
      if (res.headersSent) { res.destroy(); return; }
      const known = error instanceof HttpFailure, status = known ? error.status : 502;
      const body = JSON.stringify({ error: known ? error.code : 'DEV_API_FAILED' });
      if (!res.headersSent) res.writeHead(status, { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', 'content-length':Buffer.byteLength(body), connection:'close' });
      res.end(req.method === 'HEAD' ? undefined : body);
    }).catch(() => { res.destroy(); }).finally(() => {
      if (res.destroyed || res.writableFinished) finish();
      // Otherwise finish/close owns release; the deadline also bounds backpressured writes.
    });
  };
  private async respond(req: IncomingMessage, raw: string, signal: AbortSignal): Promise<Reply> {
    if (raw.length > 8192 || /[\\#\x00-\x20\x7f]/.test(raw)) throw new HttpFailure(400, 'REQUEST_PATH_INVALID');
    let url: URL, path: string;
    try {
      url = new URL(raw, 'http://cormi.invalid'); path = decodeURIComponent(raw.split('?')[0]!);
      if (url.origin !== 'http://cormi.invalid' || path.split('/').some(x=>x==='.'||x==='..') || /[\\\x00-\x1f\x7f]/.test(path)) throw new Error();
    } catch { throw new HttpFailure(400, 'REQUEST_PATH_INVALID'); }
    if (req.headers.origin) {
      let allowed = false;
      try { const origin = new URL(req.headers.origin); allowed = ['http:','https:'].includes(origin.protocol) && origin.host === req.headers.host; } catch {}
      if (!allowed) throw new HttpFailure(403, 'CROSS_ORIGIN_DENIED');
    }
    const method = req.method ?? 'GET'; if (!methods.has(method)) throw new HttpFailure(405, 'METHOD_NOT_ALLOWED');
    // Validate the decoded path above, but retain encoding when matching and forwarding.
    // Decoding %2F or %25 here would change an upstream resource identifier.
    const local = url.pathname.slice(this.options.prefix.length) || '/';
    const mock = this.options.mocks.find(x=>x.path===local && x.method===method)
      ?? (method==='HEAD' ? this.options.mocks.find(x=>x.path===local && x.method==='GET') : undefined);
    const route = this.options.proxies.find(x=>x.path==='/' || under(local, x.path));
    if (!mock && !route) throw new HttpFailure(404, 'DEV_API_NOT_FOUND');
    const rawBody = await collect(req, this.options.maxBodyBytes, signal);
    if (!mock) return proxy(route!, local, url.search, method, req.headers, rawBody, signal, this.options.maxResponseBytes);
    let body: unknown;
    if (rawBody.length) {
      if ((req.headers['content-type'] ?? '').split(';')[0]!.trim().toLowerCase() !== 'application/json') throw new HttpFailure(415, 'JSON_BODY_REQUIRED');
      try { body = JSON.parse(rawBody.toString('utf8')); } catch { throw new HttpFailure(400, 'JSON_BODY_INVALID'); }
    }
    let reply: MockResponse;
    try { reply = await mock.handle(Object.freeze({ method, path: local, query: url.searchParams, body, signal })); }
    catch { signal.throwIfAborted(); throw new HttpFailure(500, 'MOCK_HANDLER_FAILED'); }
    signal.throwIfAborted();
    if (!reply || typeof reply !== 'object' || !Number.isInteger(reply.status ?? 200) || (reply.status ?? 200) < 200 || (reply.status ?? 200) > 599) throw new HttpFailure(500, 'MOCK_RESPONSE_INVALID');
    const status = reply.status ?? 200, text = [204,205,304].includes(status) ? '' : JSON.stringify(reply.body ?? null);
    if (typeof text !== 'string' || Buffer.byteLength(text) > this.options.maxResponseBytes) throw new HttpFailure(500, 'MOCK_RESPONSE_INVALID');
    return { status, headers: { 'content-type':'application/json; charset=utf-8', 'cache-control':'no-store', ...headers(reply.headers ?? {}) },
      body: Buffer.from(text), contentLength: [204,304].includes(status) ? undefined : String(Buffer.byteLength(text)) };
  }
  close(): Promise<void> {
    return this.closing ??= (async () => {
      for (const control of this.active) control.abort(new HttpFailure(503, 'DEV_API_CLOSED'));
      await deadline(Promise.allSettled([...this.pending, ...this.responses]), 2000, new CormiError('DEV_API_CLEANUP_TIMEOUT', 'An API handler or response did not settle after cancellation.'));
    })();
  }
}
