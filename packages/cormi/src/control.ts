import type { EventEmitter } from 'node:events';

/** Optional parent-to-CLI control over an already established Node IPC channel. */
export interface LauncherControlSource extends EventEmitter {
  readonly connected?: boolean;
  readonly send?: unknown;
}
export function isShutdownMessage(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Record<string, unknown>;
  return Object.keys(message).length === 2 && Object.hasOwn(message, 'version') && Object.hasOwn(message, 'type')
    && message.version === 1 && message.type === 'cormi:shutdown';
}
/** Signals are for interactive consoles; IPC is cooperative automation, not kill(SIGTERM). */
export function bindLauncherControl(controller: AbortController, source: LauncherControlSource = process): () => void {
  let closed = false;
  const stop = () => { if (!closed) controller.abort(); };
  const message = (value: unknown) => { if (isShutdownMessage(value)) stop(); };
  const hasParent = source.connected === true && typeof source.send === 'function';
  source.on('SIGINT', stop); source.on('SIGTERM', stop);
  if (hasParent) { source.on('message', message); source.on('disconnect', stop); }
  return () => {
    if (closed) return; closed = true;
    source.off('SIGINT', stop); source.off('SIGTERM', stop);
    if (hasParent) { source.off('message', message); source.off('disconnect', stop); }
  };
}
