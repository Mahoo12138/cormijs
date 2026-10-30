{{#plugins}}
import * as Plugin_{{{ index }}} from '{{{ path }}}';
{{/plugins}}
import { PluginManager } from '{{{ rendererPath }}}';

function __defaultExport(obj) {
  if (obj.default) {
    return typeof obj.default === 'function' ? obj.default() : obj.default;
  }
  return obj;
}

export function getPlugins() {
  return [
{{#plugins}}
    {
      apply: {{#hasDefaultExport}}__defaultExport(Plugin_{{{ index }}}){{/hasDefaultExport}}{{^hasDefaultExport}}Plugin_{{{ index }}}{{/hasDefaultExport}},
      path: process.env.NODE_ENV === 'production' ? void 0 : '{{{ path }}}',
    },
{{/plugins}}
  ];
}

export function getValidKeys() {
  return [{{#validKeys}}'{{{ . }}}',{{/validKeys}}];
}

let pluginManager = null;

export function createPluginManager() {
  pluginManager = PluginManager.create({
    plugins: getPlugins(),
    validKeys: getValidKeys(),
  });
  // keep the manager across HMR updates of this module
  if (import.meta.hot) {
    import.meta.hot.data.pluginManager = pluginManager;
  }
  return pluginManager;
}

export function getPluginManager() {
  if (import.meta.hot && import.meta.hot.data.pluginManager) {
    return import.meta.hot.data.pluginManager;
  }
  return pluginManager;
}
