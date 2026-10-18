import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createProject } from '@cormijs/create';
import ts from 'typescript';

// Migration of one reviewed upstream snapshot, not a general repository importer.
const repositoryRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const hash=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const sha='69e780a40c455d664b2e13c525faf1d492a072a7';
const {values}=parseArgs({strict:true,options:{upstream:{type:'string'},kit:{type:'string'},out:{type:'string'}}});
assert.ok(values.kit&&values.out,'Required: --kit <verified local kit> --out <new independent application>');
const source=await realpath(values.upstream??join(repositoryRoot,'.cache/admin-upstream-material-kit'));
const destination=resolve(values.out);
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim(),sha,'Wrong upstream revision');
const ledger=JSON.parse(await readFile(join(repositoryRoot,'artifacts/admin-upstream.json'),'utf8')) as {commit:string;source_files:Record<string,{bytes:number;sha256:string}>};
assert.equal(ledger.commit,sha);
const input=new Map<string,Buffer>();
for(const [name,expected] of Object.entries(ledger.source_files)){
  assert.ok(/^(src|public)\//.test(name)&&!name.split('/').includes('..')&&!name.includes('\\'));
  const path=join(source,name),info=await lstat(path);
  assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&info.size===expected.bytes&&await realpath(path)===path);
  const bytes=await readFile(path);assert.equal(hash(bytes),expected.sha256,'Changed upstream source: '+name);input.set(name,bytes);
}
for(const name of ['index.html','LICENSE.md','package.json','package-lock.json','tsconfig.json']){
  const path=join(source,name),info=await lstat(path);assert.ok(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&info.size<4*1024**2&&await realpath(path)===path);
  const bytes=await readFile(path);assert.deepEqual(bytes,execFileSync('git',['show',sha+':'+name],{cwd:source}),name+' differs from the reviewed commit');input.set(name,bytes);
}
const originalPackage=JSON.parse(input.get('package.json')!.toString()) as {version:string;dependencies:Record<string,string>};
const lock=JSON.parse(input.get('package-lock.json')!.toString()) as {packages:Record<string,{version:string}>};
// MUI's own transitive minor releases change theme types. Keep the reviewed MUI family together, not only material itself.
const muiOverrides=Object.fromEntries(Object.entries(lock.packages).filter(([path])=>/^node_modules\/@mui\/[^/]+$/.test(path)).map(([path,item])=>[path.slice('node_modules/'.length),item.version]));
const dependencies=Object.fromEntries(Object.keys(originalPackage.dependencies).map(name=>{
  const version=lock.packages['node_modules/'+name]?.version;assert.ok(version,'Missing locked direct dependency '+name);return [name,version];
}));
const sections=input.get('src/routes/sections.tsx')!.toString();
const marker='export const routesSection: RouteObject[] = [';
assert.equal(sections.split(marker).length,2);
const adaptedSections=sections.slice(0,sections.indexOf(marker)).replace("import type { RouteObject } from 'react-router';\n\n",'')+`// cormi owns the route graph; preserve the original React.lazy pages and Suspense layout.
export function DashboardRoute() {
  return <DashboardLayout><Suspense fallback={renderFallback()}><Outlet /></Suspense></DashboardLayout>;
}
export function AuthRoute() { return <AuthLayout><SignInPage /></AuthLayout>; }
`;
const module=(exportName:string)=>({specifier:'./src/routes/sections.tsx',exportName});
const routes=[
  {id:'app',module:{specifier:'./src/cormi-root.tsx',exportName:'default'},errorBoundary:{specifier:'./src/routes/components/error-boundary.tsx',exportName:'ErrorBoundary'},source:{file:'src/main.tsx'}},
  {id:'dashboard-layout',parentId:'app',module:module('DashboardRoute'),source:{file:'src/routes/sections.tsx'}},
  ...[['dashboard','','DashboardPage'],['user','user','UserPage'],['products','products','ProductsPage'],['blog','blog','BlogPage']].map(([id,path,name])=>({id,parentId:'dashboard-layout',...(path?{path}:{index:true}),module:module(name!),source:{file:'src/routes/sections.tsx'}})),
  {id:'sign-in',parentId:'app',path:'sign-in',module:module('AuthRoute'),source:{file:'src/routes/sections.tsx'}},
  {id:'not-found',parentId:'app',path:'404',module:module('Page404'),source:{file:'src/routes/sections.tsx'}},
  {id:'catch-all',parentId:'app',path:'*',module:module('Page404'),source:{file:'src/routes/sections.tsx'}},
];
const config=`import { defineConfig } from 'cormijs';
import preset from '@cormijs/preset-react-vite';
import type { Plugin } from '@cormijs/core';
import type {} from '@cormijs/plugin-vite';
import { fileURLToPath } from 'node:url';
const alias: Plugin.Object<void> = { name:'admin:source-alias', inject:['vite'], apply(ctx) {
  ctx.effect(()=>ctx.vite.add('admin:source-alias',()=>({name:'admin:source-alias',config(){return {resolve:{alias:{src:fileURLToPath(new URL('./src',import.meta.url))}}}}})));
}};
// Root deployment first. /admin/ assets remain a separately tracked AM10 task.
export default defineConfig({presets:[preset],plugins:[{id:'admin-alias',plugin:alias}],app:{strict:true,base:'/',server:{host:'127.0.0.1',port:3039},routes:${JSON.stringify(routes,null,2)}}});
`;
const parsedConfig=ts.parseConfigFileTextToJson('tsconfig.json',input.get('tsconfig.json')!.toString());
assert.equal(parsedConfig.error,undefined,'Invalid upstream tsconfig');
const tsconfig=parsedConfig.config as {compilerOptions:Record<string,unknown>;references?:unknown;include:string[]};
delete tsconfig.references; // Removed tools belong to upstream's Vite compiler, not the application's typecheck.
tsconfig.compilerOptions.paths={'src/*':['./src/*']};tsconfig.include=['src','cormi.config.ts','.cormi'];
// createProject validates kit bytes, admits only a new target and brings all archives/patches into that target.
const created=await createProject({directory:destination,kit:values.kit,name:'cormi-material-kit',template:'react'});
for(const file of created.files.filter(file=>file.startsWith('src/'))) await unlink(join(destination,file));
const targetIdentity=await lstat(destination);
const write=async(name:string,content:Buffer|string)=>{
  const now=await lstat(destination);assert.ok(now.isDirectory()&&!now.isSymbolicLink()&&now.ino===targetIdentity.ino&&now.dev===targetIdentity.dev,'Destination identity changed');
  await mkdir(dirname(join(destination,name)),{recursive:true});await writeFile(join(destination,name),content);
};
const copied:string[]=[],modified:Record<string,{before:string;after:string}>={};
for(const [name,bytes] of input){
  if(!/^(src|public)\//.test(name)||name==='src/main.tsx'||name==='src/routes/sections.tsx') continue;
  await write(name,bytes);copied.push(name);
}
await write('src/routes/sections.tsx',adaptedSections);modified['src/routes/sections.tsx']={before:hash(sections),after:hash(adaptedSections)};
await write('src/cormi-root.tsx',"import { Outlet } from 'react-router';\nimport App from './app';\nexport default function CormiRoot(){return <App><Outlet /></App>;}\n");
await write('index.html',input.get('index.html')!.toString().replace('/src/main.tsx','/.cormi/app.tsx'));
await write('LICENSE-UPSTREAM.md',input.get('LICENSE.md')!);
await write('cormi.config.ts',config);await write('tsconfig.json',JSON.stringify(tsconfig,null,2)+'\n');
const targetPackage=JSON.parse(await readFile(join(destination,'package.json'),'utf8'));
const refs=targetPackage.pnpm.overrides;
targetPackage.pnpm.overrides={...refs,...muiOverrides};
targetPackage.version=originalPackage.version;targetPackage.description='Material Kit React snapshot adapted to cormi; see MIGRATION.md and upstream license.';
targetPackage.dependencies={...dependencies,...targetPackage.dependencies,'react-router-dom':'7.18.2','@cormijs/core':refs['@cormijs/core'],'@cormijs/plugin-vite':refs['@cormijs/plugin-vite']};
targetPackage.scripts={dev:'cormi dev --startup-timeout 60000',build:'cormi build --startup-timeout 60000',preview:'cormi preview',typecheck:'cormi typecheck --startup-timeout 60000',inspect:'cormi inspect'};
await write('package.json',JSON.stringify(targetPackage,null,2)+'\n');
await write('MIGRATION.md',`# Material Kit React → cormi\n\nUpstream: ${sha}. Copyright and permission: LICENSE-UPSTREAM.md.\n\nThe original business components and assets are preserved. cormi owns createRoot, RouterProvider and the route graph. src/cormi-root.tsx keeps App inside the router; original lazy page exports and Dashboard Suspense remain. The custom error boundary is an eager route reference. StrictMode is enabled. src/main.tsx and the old Vite launch configuration are not executed/copied.\n\nThe application tsconfig removes the obsolete Vite-tools project reference and explicitly maps src/*. Strict remains enabled. React/React DOM are 19.3.1 and React Router/DOM 7.18.2 to match cormi's tested peers; remaining direct UI packages and the transitive @mui family are pinned from the original lock. The first unpinned system minor changed borderRadius to string-or-number and caused three real type errors; preserving the original family avoids source casts or weakened checks. The new dependency lock must be retained after installation.\n\nRun pnpm install --ignore-scripts, pnpm typecheck, pnpm dev. Stop dev before build/preview. The entire directory is self-contained with .cormi-local. No backend auth/CRUD added; Products/Blog controls retain their original demonstration semantics. Root deployment only so far; /admin/ assets and remaining AM issues are not declared complete.\n`);
await write('migration.json',JSON.stringify({format:'cormi:admin-migration:1',upstream:sha,sourceFiles:copied,modified,omitted:['src/main.tsx'],newFiles:['src/cormi-root.tsx','cormi.config.ts'],installationPerformed:false,moduleAcceptanceComplete:false},null,2)+'\n');
console.log(JSON.stringify({directory:destination,copied:copied.length,modified:Object.keys(modified),installed:false}));
