import { useEffect, useState, type ReactNode } from 'react';

export interface ClientOnlyProps {
  /** Rendered on the server and during the first client render. */
  readonly fallback?: ReactNode;
  readonly children?: ReactNode;
}

/** Defers browser-only content until after hydration; the server never renders the children. */
export function ClientOnly({ fallback = null, children }: ClientOnlyProps) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return <>{hydrated ? children : fallback}</>;
}
