import { loadMicroApp } from 'qiankun';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';

export interface QiankunMicroAppProps {
  readonly name: string;
  /** Absolute or page-relative qiankun HTML entry. */
  readonly entry: string;
  /** Props forwarded once when the micro app is loaded. */
  readonly props?: Readonly<Record<string, unknown>>;
  readonly className?: string;
  readonly style?: CSSProperties;
  readonly fallback?: ReactNode;
}

/** Host-side qiankun adapter: loads one micro app into a component-owned container and unmounts it with React. */
export function QiankunMicroApp({ name, entry, props, className, style, fallback }: QiankunMicroAppProps) {
  const container = useRef<HTMLDivElement>(null), propsRef = useRef(props), [error, setError] = useState<string>();
  propsRef.current = props;
  useEffect(() => {
    if (typeof window === 'undefined' || !container.current) return;
    if (typeof name !== 'string' || !name || typeof entry !== 'string' || !entry) { setError('invalid name or entry'); return; }
    let app: ReturnType<typeof loadMicroApp> | undefined, active = true;
    try {
      const absolute = new URL(entry, window.location.href).href;
      app = loadMicroApp({ name, entry: absolute, container: container.current, props: propsRef.current }, { sandbox: true, singular: false });
      void Promise.resolve(app.mountPromise).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
    return () => {
      active = false;
      void Promise.resolve(app?.unmount()).catch(() => {});
    };
  }, [name, entry]);
  return <div ref={container} className={className} style={style} data-qiankun-host={name}>
    {error ? fallback ?? <div role="alert">Micro app failed: {error}</div> : null}
  </div>;
}
