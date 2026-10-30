import type { PluginAPI } from './api.ts'

/** Builtin preset: registers the hooks the service itself applies. */
export function servicePlugin(api: PluginAPI) {
  [
    'onCheck',
    'onStart',
    'modifyAppData',
    'modifyConfig',
    'modifyDefaultConfig',
    'modifyPaths',
    'modifyTelemetryStorage',
  ].forEach((name) => {
    api.registerMethod({ name })
  })
}

servicePlugin.id = '@cormi/core/servicePlugin'
servicePlugin.key = 'servicePlugin'
