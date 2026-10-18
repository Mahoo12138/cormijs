import test,{type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir,mkdtemp,readFile,realpath,rename,rm,symlink,writeFile,readdir,link } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createProject } from '@cormijs/create';
const sha=(text:string)=>createHash('sha256').update(text).digest('hex');
// Malformed local manifests must fail before admitting any destination directory.

async function fixture(t:TestContext){
  const root=await realpath(await mkdtemp(join(tmpdir(),'cormi create 中文 '))),kit=join(root,'kit'),target=join(root,'new app 中文');
  t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(join(kit,'tarballs'),{recursive:true});await mkdir(join(kit,'compatibility'));
  const names=['cormijs','@cormijs/preset-react-vite','@cormijs/runtime','@cormijs/plugin-dev-api','@cormijs/plugin-vite'];
  const packages=await Promise.all(names.map(async(name,i)=>{const file='tarballs/package-'+i+'.tgz',text='opaque test tarball '+i;await writeFile(join(kit,file),text);return {name,version:'0.0.1',file,sha256:sha(text)};}));
  await writeFile(join(kit,'compatibility/cordis.patch'),'test declaration patch');await writeFile(join(kit,'compatibility/CORDIS-LICENSE'),'test license');
  const manifest={format:'cormi:local-kit:1',packages,compatibility:{package:'cordis@4.0.0-rc.11',patch:'compatibility/cordis.patch',sha256:sha('test declaration patch'),runtimeModified:false}};
  const save=()=>writeFile(join(kit,'manifest.json'),JSON.stringify(manifest));await save();return {root,kit,target,manifest,save};
}
test('creator emits a standalone project, explicit patch and local tarballs without installation',async t=>{
 const f=await fixture(t),r=await createProject({directory:f.target,kit:f.kit,template:'react-api',name:'my-app'});
 assert.equal(r.installed,false);assert.equal(r.packageCount,5);assert.equal(existsSync(join(f.target,'node_modules')),false);assert.equal(existsSync(join(f.target,'.git')),false);
 const p=JSON.parse(await readFile(join(f.target,'package.json'),'utf8'));assert.equal(p.name,'my-app');assert.ok(p.dependencies['@cormijs/plugin-dev-api']);assert.match(p.pnpm.patchedDependencies['cordis@4.0.0-rc.11'],/^\.cormi-local\//);
 assert.equal(await readFile(join(f.target,'pnpm-workspace.yaml'),'utf8'),'packages: []\n');assert.match(await readFile(join(f.target,'mock.ts'),'utf8'),/MockRule/);
 await rm(f.kit,{recursive:true});const moved=join(f.root,'moved app');await rename(f.target,moved);assert.match(await readFile(join(moved,'.cormi-local/tarballs/package-0.tgz'),'utf8'),/opaque test/);
});
test('basic template does not include the optional API plugin',async t=>{
 const f=await fixture(t);await createProject({directory:f.target,kit:f.kit});const p=JSON.parse(await readFile(join(f.target,'package.json'),'utf8'));assert.equal(p.dependencies['@cormijs/plugin-dev-api'],undefined);assert.equal(existsSync(join(f.target,'mock.ts')),false);
});
test('creator refuses existing directories and preserves every existing byte',async t=>{
 const f=await fixture(t);await mkdir(f.target);await writeFile(join(f.target,'mine.txt'),'do not touch');await assert.rejects(createProject({directory:f.target,kit:f.kit}),{code:'CREATE_TARGET_EXISTS'});assert.deepEqual(await readdir(f.target),['mine.txt']);assert.equal(await readFile(join(f.target,'mine.txt'),'utf8'),'do not touch');
});
test('concurrent creators grant one destination and never overwrite the winner',async t=>{
 const f=await fixture(t);const results=await Promise.allSettled([createProject({directory:f.target,kit:f.kit,name:'one'}),createProject({directory:f.target,kit:f.kit,name:'two'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);assert.ok(['one','two'].includes(JSON.parse(await readFile(join(f.target,'package.json'),'utf8')).name));
});
test('checksum mismatch and patch mismatch fail before creating the destination',async t=>{
 const f=await fixture(t);await writeFile(join(f.kit,f.manifest.packages[0]!.file),'tampered');await assert.rejects(createProject({directory:f.target,kit:f.kit}),{code:'CREATE_KIT_INVALID'});assert.equal(existsSync(f.target),false);
 await writeFile(join(f.kit,f.manifest.packages[0]!.file),'opaque test tarball 0');await writeFile(join(f.kit,'compatibility/cordis.patch'),'tampered');await assert.rejects(createProject({directory:f.target,kit:f.kit}),{code:'CREATE_KIT_INVALID'});assert.equal(existsSync(f.target),false);
});
test('manifest traversal, duplicate names and missing required packages are rejected',async t=>{
 const f=await fixture(t);const original=f.manifest.packages[0]!.file;f.manifest.packages[0]!.file='../outside.tgz';await f.save();await assert.rejects(createProject({directory:f.target,kit:f.kit}),{code:'CREATE_KIT_INVALID'});f.manifest.packages[0]!.file=original;
 f.manifest.packages.push(f.manifest.packages[0]!);await f.save();await assert.rejects(createProject({directory:f.target,kit:f.kit}),{code:'CREATE_KIT_INVALID'});f.manifest.packages.pop();f.manifest.packages.shift();await f.save();await assert.rejects(createProject({directory:f.target,kit:f.kit}),{code:'CREATE_KIT_INVALID'});assert.equal(existsSync(f.target),false);
});
test('kit file symlinks and hardlinks are refused, not copied or dereferenced',async t=>{
 for(const kind of ['symlink','hardlink']){const f=await fixture(t),source=join(f.kit,f.manifest.packages[0]!.file),outside=join(f.root,'outside');await rename(source,outside);if(kind==='symlink')await symlink(outside,source);else await link(outside,source);await assert.rejects(createProject({directory:f.target,kit:f.kit}),{code:'CREATE_KIT_INVALID'});assert.equal(existsSync(f.target),false);}
});
test('invalid template/name and pre-aborted creation leave no output',async t=>{
 const f=await fixture(t);await assert.rejects(createProject({directory:f.target,kit:f.kit,template:'unknown' as 'react'}),{code:'CREATE_TEMPLATE_INVALID'});await assert.rejects(createProject({directory:f.target,kit:f.kit,name:'Bad Name'}),{code:'CREATE_NAME_INVALID'});const signal=AbortSignal.abort();await assert.rejects(createProject({directory:f.target,kit:f.kit,signal}));assert.equal(existsSync(f.target),false);
});
test('manifest package fields are strings, not values accepted by implicit RegExp coercion', async t => {
  const f = await fixture(t);
  const raw = JSON.parse(JSON.stringify(f.manifest)); raw.packages[0].version = ['0.0.1'];
  await writeFile(join(f.kit, 'manifest.json'), JSON.stringify(raw));
  await assert.rejects(createProject({ directory: f.target, kit: f.kit }), { code: 'CREATE_KIT_INVALID' });
  assert.equal(existsSync(f.target), false);
});
test('destination parent aliases and linked kit ancestors fail without writing the referenced directory', async t => {
  const f = await fixture(t); const alias = join(f.root, 'alias'); await symlink(f.root, alias, 'dir');
  await assert.rejects(createProject({ directory: join(alias, 'new'), kit: f.kit }), { code: 'CREATE_PATH_INVALID' });
  assert.equal(existsSync(join(f.root, 'new')), false);
  const original = join(f.kit, 'tarballs'), moved = join(f.root, 'real-tarballs');
  await rename(original, moved); await symlink(moved, original, 'dir');
  await assert.rejects(createProject({ directory: f.target, kit: f.kit }), { code: 'CREATE_KIT_INVALID' });
  assert.equal(existsSync(f.target), false);
});
