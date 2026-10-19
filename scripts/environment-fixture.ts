import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Page } from 'playwright-core';

export const environmentLiteral='${CORMI_PRIVATE_VALUE}/$CORMI_PRIVATE_VALUE';
export const privateMarkers=['PRIVATE_ENV_SENTINEL_341','VITE_ENV_SENTINEL_723','LATE_ENV_SENTINEL_892'];
/** Synthetic input only. Never read or copy a developer's real dotenv files. */
export function environmentFixture(base='/stage/',port=0):Record<string,string>{return {
 'cormi.config.ts':`import {defineConfig} from 'cormijs';import preset from '@cormijs/preset-react-vite';
export default defineConfig(({env,mode})=>{
 const value=env.CORMI_PUBLIC_VALUE,literal=env.CORMI_PUBLIC_LITERAL,node=env.NODE_ENV;
 // Public compilation uses the bootstrap snapshot, not later process-global writes.
 process.env.CORMI_PUBLIC_VALUE='LATE_ENV_SENTINEL_892';process.env.CORMI_PUBLIC_LATE='LATE_ENV_SENTINEL_892';
 return {presets:[preset],app:{base:${JSON.stringify(base)},server:{host:'127.0.0.1',port:${port}},
 routes:[{id:'probe',path:'probe',module:{specifier:'./src/Probe.tsx',exportName:'default'},source:{file:'src/Probe.tsx'}}],
 runtime:[{id:'environment-fixture',module:{specifier:'./src/runtime.ts',exportName:'default'},options:{value,literal,node,mode}}]}};
});`,
 'src/runtime.ts':`import type {RuntimePlugin} from '@cormijs/runtime';const runtime:RuntimePlugin={setup({options}){document.documentElement.dataset.cormiEnvironment=JSON.stringify(options);return ()=>{delete document.documentElement.dataset.cormiEnvironment;}}};export default runtime;`,
 'src/Probe.tsx':`import {useState} from 'react';
export default function Probe(){const [count,setCount]=useState(0);const env=import.meta.env;
const snapshot=JSON.parse(document.documentElement.dataset.cormiEnvironment!);
const values={value:env.CORMI_PUBLIC_VALUE,literal:env.CORMI_PUBLIC_LITERAL,mode:env.MODE,dev:env.DEV,prod:env.PROD,base:env.BASE_URL,
 privatePresent:Object.hasOwn(env,'CORMI_PRIVATE_VALUE'),vitePresent:Object.hasOwn(env,'VITE_IGNORED'),latePresent:Object.hasOwn(env,'CORMI_PUBLIC_LATE'),snapshot};
return <main><h1>环境配置验证：{env.CORMI_PUBLIC_VALUE}</h1><p>mode: {env.MODE} / {env.PROD?'production':'development'}</p><button onClick={()=>setCount(n=>n+1)}>Count: {count}</button><pre id="environment-values">{JSON.stringify(values,null,2)}</pre></main>}`,
 'src/env.d.ts':`interface ImportMetaEnv {readonly CORMI_PUBLIC_VALUE:string;readonly CORMI_PUBLIC_LITERAL:string;readonly MODE:string;readonly BASE_URL:string;readonly DEV:boolean;readonly PROD:boolean;readonly [key:string]:unknown}interface ImportMeta{readonly env:ImportMetaEnv}`,
 'index.html':'<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>cormi env %CORMI_PUBLIC_VALUE%</title><style>body{font-family:system-ui,sans-serif;margin:0}main{max-width:780px;margin:5vh auto;padding:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}button{font:inherit;padding:8px}</style></head><body><div id="root"></div><script type="module" src="/.cormi/app.tsx"></script></body></html>',
 'tsconfig.json':JSON.stringify({compilerOptions:{target:'ES2023',module:'ESNext',moduleResolution:'Bundler',jsx:'react-jsx',strict:true,noEmit:true,skipLibCheck:false},include:['src','.cormi','cormi.config.ts']}),
 '.env':`CORMI_PUBLIC_VALUE=base\nCORMI_PRIVATE_VALUE=${privateMarkers[0]}\nVITE_IGNORED=${privateMarkers[1]}\nCORMI_PUBLIC_LITERAL=${environmentLiteral}\n`,
 '.env.local':'CORMI_PUBLIC_VALUE=local\n',
 '.env.staging':'CORMI_PUBLIC_VALUE=staging\n',
 '.env.staging.local':'CORMI_PUBLIC_VALUE=selected\nNODE_ENV=development\n',
};}
export async function writeEnvironmentFixture(root:string,base='/stage/',port=0):Promise<void>{
 for(const [path,content] of Object.entries(environmentFixture(base,port))){await mkdir(dirname(join(root,path)),{recursive:true});await writeFile(join(root,path),content,{flag:'wx'})}
}
export async function verifyEnvironmentPage(page:Page,url:string,value:string,production:boolean,navigate=true):Promise<void>{
 if(navigate)await page.goto(new URL('probe',url).href);
 await page.getByRole('heading',{name:'环境配置验证：'+value,exact:true}).waitFor({timeout:15000});
 assert.equal(page.url(),new URL('probe',url).href);assert.equal(await page.title(),'cormi env '+value);
 const data=JSON.parse(await page.locator('#environment-values').innerText());
 assert.deepEqual(data,{value,literal:environmentLiteral,mode:'staging',dev:!production,prod:production,base:new URL(url).pathname,
 privatePresent:false,vitePresent:false,latePresent:false,snapshot:{value,literal:environmentLiteral,node:production?'production':'development',mode:'staging'}});
 assert.equal(await page.locator('cormi-development-overlay,vite-error-overlay').count(),0);
 await page.getByRole('button',{name:'Count: 0',exact:true}).click();await page.getByRole('button',{name:'Count: 1',exact:true}).waitFor();
}
