import { Context, Service } from 'cordis';
import { diagnosticLabel } from './graph.js';

/** Only explicitly public identities belong here; never options, payloads or exception text. */
export interface DiagnosticContribution {
  readonly kind: string;
  readonly id: string;
  readonly ownerUid?: number | null;
  /** An upstream hook's declared label, not a verified Cordis owner identity. */
  readonly declaredOwner?: string;
}
export interface DiagnosticSection {
  readonly id: string;
  readonly collectorUid: number | null;
  readonly status: 'ready' | 'failed' | 'stale';
  readonly records: readonly DiagnosticContribution[];
}
declare module 'cordis' { interface Context { diagnostics: DiagnosticService } }

/** Optional native service for opt-in synchronous metadata collectors. No duck-typed summary() calls. */
export class DiagnosticService extends Service {
  private readonly state = { readers: new Set<{ id: string; uid: number | null; read: () => readonly DiagnosticContribution[] }>(), revision: 0, closed: false };
  constructor(ctx: Context) {
    super(ctx, 'diagnostics');
    ctx.effect(() => () => { this.state.closed = true; this.state.readers.clear(); this.state.revision++; });
  }

  add(id: string, read: () => readonly DiagnosticContribution[]): () => Promise<void> {
    const state = this.state;
    if (state.closed) throw new Error('Diagnostic service is closed');
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id) || typeof read !== 'function') throw new TypeError('Invalid diagnostic collector');
    const uid = this.ctx.fiber.uid;
    if (state.readers.size >= 128 || [...state.readers].some(r => r.id === id && r.uid === uid)) throw new Error('Duplicate or excessive diagnostic collectors');
    const entry = { id, uid, read };
    const off = this.ctx.effect(() => {
      state.readers.add(entry); state.revision++;
      return () => { if (state.readers.delete(entry)) state.revision++; };
    });
    let closing: Promise<void> | undefined;
    return () => {
      // Revoke admission synchronously, including when another collector calls this disposer.
      if (state.readers.delete(entry)) state.revision++;
      return closing ??= Promise.resolve().then(() => off()).then(() => {});
    };
  }

  snapshot(): readonly DiagnosticSection[] {
    const state = this.state, version = state.revision; let total = 0;
    const empty = (entry: { id: string; uid: number | null }, status: 'failed' | 'stale'): DiagnosticSection =>
      Object.freeze({ id: entry.id, collectorUid: entry.uid, status, records: Object.freeze([]) });
    const result = [...state.readers].map((entry): DiagnosticSection => {
      try {
        if (!state.readers.has(entry)) return empty(entry, 'stale');
        const raw: unknown = entry.read();
        if (raw instanceof Promise) { void raw.catch(() => {}); throw new TypeError('Collectors must be synchronous'); }
        if (!Array.isArray(raw) || raw.length > 512 || (total += raw.length) > 2048 || Reflect.ownKeys(raw).length !== raw.length + 1) throw new TypeError('Invalid metadata size');
        const records: DiagnosticContribution[] = [];
        for (let i = 0; i < raw.length; i++) {
          const item = Object.getOwnPropertyDescriptor(raw, String(i));
          if (!item || !('value' in item)) throw new TypeError('Invalid metadata item');
          const value = item.value;
          if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new TypeError('Invalid metadata record');
          for (const key of Reflect.ownKeys(value)) {
            const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
            if (typeof key !== 'string' || !['id', 'kind', 'ownerUid', 'declaredOwner'].includes(key) || !('value' in descriptor)) throw new TypeError('Unexpected metadata field');
          }
          if (!Object.hasOwn(value, 'id') || !Object.hasOwn(value, 'kind') || typeof value.id !== 'string' || typeof value.kind !== 'string'
            || value.declaredOwner !== undefined && typeof value.declaredOwner !== 'string'
            || value.ownerUid !== undefined && value.ownerUid !== null && (!Number.isSafeInteger(value.ownerUid) || value.ownerUid < 0)) throw new TypeError('Invalid metadata identity');
          records.push(Object.freeze({ id: diagnosticLabel(value.id), kind: diagnosticLabel(value.kind),
            ...(value.ownerUid !== undefined ? { ownerUid: value.ownerUid } : {}),
            ...(value.declaredOwner !== undefined ? { declaredOwner: diagnosticLabel(value.declaredOwner) } : {}) }));
        }
        if (version !== state.revision) return empty(entry, 'stale');
        return Object.freeze({ id: entry.id, collectorUid: entry.uid, status: 'ready', records: Object.freeze(records) });
      } catch { return empty(entry, 'failed'); }
    });
    // Never combine records across collector registration revisions.
    if (version !== state.revision) return Object.freeze(result.map(s => empty({ id: s.id, uid: s.collectorUid }, 'stale')));
    return Object.freeze(result);
  }
}
