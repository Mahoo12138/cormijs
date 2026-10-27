// Vite expands import.meta.glob at build time against the application's project root.
// The glob API is declared locally below so this file does not need a vite devDependency;
// the actual runtime replacement is done by Vite when it processes this file as application code
// (it is excluded from the optimizer via plugin-dva so Vite sees the raw source).
//
// Pattern is hardcoded to `/src/models/**`; custom directories and extraModels are not
// supported through this entrypoint — use createDvaRuntime() directly in src/app.tsx
// (or a dedicated runtime module) when you need a different path or extra models.

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- consumed by the declaration below
declare global {
  interface ImportMeta {
    glob(pattern: string | readonly string[], options?: { eager?: boolean }): Record<string, unknown>;
  }
}

import type { RuntimePlugin } from '@cormijs/runtime';
import { createElement, useRef, type ComponentType, type ReactNode } from 'react';
import { createDvaRuntime, type DvaModel, type DvaRuntimeOptions } from './index.js';

const discovered: Record<string, unknown> = import.meta.glob(
  ['/src/models/**/*.{ts,tsx,js,jsx}', '!/src/models/**/*.{test,spec}.*', '!/src/models/**/*.d.ts'],
  { eager: true },
);

const models: DvaModel[] = Object.entries(discovered).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([file, value]) => {
  const model = (value as { default?: unknown }).default;
  if (!model || typeof model !== 'object' || Array.isArray(model)) {
    throw new Error(`DVA_INVALID: ${file} must default-export a dva model object`);
  }
  return model as DvaModel;
});

/** Runtime contribution behind @cormijs/plugin-dva; options control immer/loading per application. */
export const dvaRuntime: RuntimePlugin = {
  Provider({ options, children }) {
    const ref = useRef<{ Provider: ComponentType<{ children?: ReactNode }> } | undefined>(undefined);
    if (!ref.current) ref.current = createDvaRuntime(models, { ...(options as DvaRuntimeOptions), allowEmpty: true });
    return createElement(ref.current.Provider, null, children);
  },
};
