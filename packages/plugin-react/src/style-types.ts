/**
 * Ambient declarations for Vite-style CSS/asset imports. Class names stay string-indexed:
 * without parsing every preprocessor dialect this is the safe, non-surprising shape.
 */
export function generateStyleTypes(): string {
  return `declare module '*.module.css' { const classes: Readonly<Record<string, string>>; export default classes; }
declare module '*.module.scss' { const classes: Readonly<Record<string, string>>; export default classes; }
declare module '*.module.sass' { const classes: Readonly<Record<string, string>>; export default classes; }
declare module '*.module.less' { const classes: Readonly<Record<string, string>>; export default classes; }
declare module '*.css';
declare module '*.scss';
declare module '*.sass';
declare module '*.less';
declare module '*.svg' { const src: string; export default src; }
declare module '*.png' { const src: string; export default src; }
declare module '*.jpg' { const src: string; export default src; }
declare module '*.jpeg' { const src: string; export default src; }
declare module '*.gif' { const src: string; export default src; }
declare module '*.webp' { const src: string; export default src; }
declare module '*.avif' { const src: string; export default src; }
declare module '*.ico' { const src: string; export default src; }
declare module '*.woff' { const src: string; export default src; }
declare module '*.woff2' { const src: string; export default src; }
`;
}

import { CormiError, type Plugin } from '@cormijs/core';
import type {} from './index.js';

export interface StyleTypesPluginOptions {
  readonly id?: string;
}

/** Opt-in so applications with their own wildcard declarations are never taken over. */
export const styleTypesPlugin: Plugin.Object<StyleTypesPluginOptions> = {
  name: 'cormi:style-types', inject: ['react'],
  apply(ctx, options = {}) {
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'id')) {
      throw new CormiError('STYLE_TYPES_INVALID', 'Invalid style types plugin options.');
    }
    const id = options.id ?? 'cormi:style-types';
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9:._-]{0,127}$/.test(id)) throw new CormiError('STYLE_TYPES_INVALID', 'Invalid style types plugin id.');
    ctx.effect(() => ctx.react.styleTypes.tap({ id, owner: id, ownerOrder: 0, stage: 0, run: () => [true] }));
  },
};
