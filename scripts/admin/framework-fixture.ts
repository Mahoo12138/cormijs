/** Test-only adapters. They move the existing Users route into a Cordis contribution;
 * no upstream component, UI behavior, or data operation is changed. */
export const settingsSource = (version = 'initial', enabled = true, fail = false, holdCleanup = false) =>
  `export const state = ${JSON.stringify({ version, enabled, fail, holdCleanup })};\n`;

export const validationPlugin = `import type { CormiConfig } from 'cormijs';
import type { Plugin } from '@cormijs/core';
import { clientModule, type RouteRecord } from '@cormijs/plugin-react';
import type {} from '@cormijs/plugin-vite';
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { setTimeout as wait } from 'node:timers/promises';
import { state } from './settings';
export function withValidation(config: CormiConfig): CormiConfig {
  if (state.fail) throw new Error('CORMI_VALIDATION_RUNTIME_FAILURE');
  const routes = config.app?.routes as readonly RouteRecord[];
  const user = routes.find(route => route.id === 'user');
  if (!user) throw new Error('Expected existing Users route');
  const probe: Plugin.Object<void> = { name: 'validation:users', inject: ['react', 'vite'], apply(ctx) {
    appendFileSync(new URL('./applied.log', import.meta.url), state.version+'\\n');
    ctx.effect(() => ctx.vite.add('validation:version', () => ({ name:'validation:version', configureServer(server) {
      server.middlewares.use((req,res,next) => {
        if (req.url?.split('?')[0]?.endsWith('/__cormi_validation_version')) { res.setHeader('Content-Type','text/plain'); res.end(state.version); } else next();
      });
    } })));
    ctx.effect(() => ctx.react.runtime.tap({ id:'validation:runtime', owner:'validation:users', ownerOrder:0,
      run:()=>[{id:'validation:runtime',module:clientModule('./runtime.ts',import.meta.url),options:{version:state.version}}] }));
    ctx.effect(() => {
      let signature = '', off: (()=>void)|undefined;
      function refresh() {
        const text = readFileSync(new URL('./routes.json',import.meta.url),'utf8');
        if (text===signature) return;
        const input = JSON.parse(text) as {path:string;enabled:boolean};
        if (typeof input.path!=='string'||typeof input.enabled!=='boolean') throw new Error('Invalid route probe');
        signature=text; off?.();
        off=ctx.react.routes.tap({id:'validation:users-route',owner:'validation:users',ownerOrder:0,
          run: current=>input.enabled?[...current,{...user!,path:input.path,source:{pluginId:'validation:users'}}]:current});
      }
      refresh(); const timer=setInterval(refresh,60);
      return async()=>{
        clearInterval(timer);off?.();
        if(state.holdCleanup){
          writeFileSync(new URL('./stopping.flag',import.meta.url),'yes');
          while(!existsSync(new URL('./release.flag',import.meta.url)))await wait(15);
        }
      };
    });
  }};
  return {...config,app:{...config.app,routes:routes.filter(route=>route.id!=='user')},
    plugins:[...(config.plugins??[]),{id:'validation:users',plugin:probe,enabled:state.enabled}]};
}
`;
export const validationRuntime = `import type { RuntimePlugin } from '@cormijs/runtime';
export default { setup({options}) {
  const {version}=options as {version:string};
  if(document.documentElement.dataset.cormiValidation)throw new Error('Duplicate validation runtime');
  document.documentElement.dataset.cormiValidation=version;
  return ()=>{delete document.documentElement.dataset.cormiValidation;};
} } satisfies RuntimePlugin;
`;
