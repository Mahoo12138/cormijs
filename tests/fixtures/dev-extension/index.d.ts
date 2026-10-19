import type { Plugin } from '@cormijs/core';
export interface Options { development: boolean; label?: string; target?: string }
declare const extension: Plugin.Object<Options>;
export default extension;
