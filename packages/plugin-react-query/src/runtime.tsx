import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useRef, type ReactNode } from 'react';
import type { ReactQueryDefaults } from './index.js';

export interface ReactQueryProviderOptions {
  readonly defaults?: ReactQueryDefaults;
}
export interface ReactQueryProviderProps {
  readonly options?: unknown;
  readonly children?: ReactNode;
}

/** One QueryClient per application mount; the cache is released with the React tree. */
export function ReactQueryProvider({ options, children }: ReactQueryProviderProps) {
  const client = useRef<QueryClient | undefined>(undefined);
  const defaults = (options as ReactQueryProviderOptions | undefined)?.defaults;
  if (!client.current) client.current = new QueryClient({ defaultOptions: { queries: { ...(defaults ?? {}) } } });
  return <QueryClientProvider client={client.current}>{children}</QueryClientProvider>;
}

export const reactQueryRuntime = Object.freeze({ Provider: ReactQueryProvider });
