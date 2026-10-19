import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, symlink, link, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnvironment, readEnvironment, resolveEnvironment, environmentFiles, validateMode } from '../packages/cormi/src/environment.js';
import { fingerprint } from '../packages/cormi/src/inputs.js';
import { hasCode } from './helpers.js';

async function fixture(t: import('node:test').TestContext) {
  const root=await mkdtemp(join(tmpdir(),'cormi env 中文 ')); t.after(()=>rm(root,{recursive:true,force:true}));return root;
}
test('environment parser supports framed quotes comments empty and multiline strings without expansion',()=>{
  const text='\uFEFF# comment\r\nexport A=one\r\nEMPTY=\r\nB="two # literal"\r\nC=\'multi\nline\'\nD=${A}/$A/$(command)\nA=last # override\nFLAG=false\nNUMBER=42\n';
  assert.deepEqual({...parseEnvironment(text,'.env')},{A:'last',EMPTY:'',B:'two # literal',C:'multi\nline',D:'${A}/$A/$(command)',FLAG:'false',NUMBER:'42'});
});
test('invalid or unfinished assignments are not silently ignored or quoted in error messages',()=>{
  for(const text of ['PRIVATE_TEST="PRIVATE_VALUE','no assignment PRIVATE_VALUE','BAD-NAME=PRIVATE_VALUE','A="PRIVATE_VALUE" junk','A=bad\0PRIVATE_VALUE','NODE_OPTIONS=--require=PRIVATE_VALUE','__proto__=PRIVATE_VALUE','CORMI_PUBLIC_=PRIVATE_VALUE']){
    assert.throws(()=>parseEnvironment(text,'.env.staging'),error=>hasCode('ENV_SYNTAX_INVALID')(error)&&!String(error).includes('PRIVATE_VALUE'));
  }
});
test('mode is a bounded filename selector rather than a filesystem path',()=>{
  for(const mode of ['', 'local','../secrets','staging.local','STAGING','a/b','a\\b','a'.repeat(65),['staging']]) assert.throws(()=>validateMode(mode),hasCode('MODE_INVALID'));
  assert.equal(environmentFiles('/project','staging')[3],'/project/.env.staging.local');
});
test('four layers plus inherited empty values have deterministic origins and no cross-load mutation',async t=>{
  const root=await fixture(t);
  for(const [file,value] of [['.env','base'],['.env.local','local'],['.env.staging','stage'],['.env.staging.local','selected']]) await writeFile(join(root,file!),`VALUE=${value}\nCORMI_PUBLIC_VALUE=${value}\nEMPTY=file\n`);
  const before=process.env.VALUE, snapshot=await readEnvironment(root,'staging');
  const inherited={VALUE:'inherited',EMPTY:'',NODE_ENV:'development'};
  const resolved=resolveEnvironment(snapshot,inherited,'production');
  assert.equal(resolved.env.VALUE,'inherited');assert.equal(resolved.env.EMPTY,'');assert.equal(resolved.env.NODE_ENV,'production');
  assert.equal(resolved.publicEnv.CORMI_PUBLIC_VALUE,'selected');assert.ok(Object.isFrozen(resolved.env));
  const source=resolved.summary.variables.find(x=>x.name==='VALUE')!;
  assert.deepEqual(source.history,['.env','.env.local','.env.staging','.env.staging.local','inherited']);
  assert.doesNotMatch(JSON.stringify(resolved.summary),/selected|file"|"value":/);
  assert.deepEqual(inherited,{VALUE:'inherited',EMPTY:'',NODE_ENV:'development'});assert.equal(process.env.VALUE,before);
  await rm(join(root,'.env.staging.local'));assert.equal(resolveEnvironment(await readEnvironment(root,'staging'),{},'production').env.VALUE,'stage');
  assert.equal(resolveEnvironment(await readEnvironment(root,'other'),{},'development').env.VALUE,'local');
});
test('missing candidates remain observable for later creation and snapshots retain accepted bytes',async t=>{
  const root=await fixture(t), initial=await readEnvironment(root,'staging');
  assert.equal(initial.files.filter(x=>x.present).length,0);await writeFile(join(root,'.env.staging.local'),'A=new');
  assert.notEqual(await fingerprint(initial.paths),initial.fingerprint);assert.equal(resolveEnvironment(initial,{},'production').env.A,undefined);
  const next=await readEnvironment(root,'staging');assert.equal(next.values.A,'new');
});
test('environment file links non-files oversize and invalid UTF8 are rejected without reading targets',async t=>{
  const root=await fixture(t), target=join(root,'target');await writeFile(target,'PRIVATE=target');
  const file=join(root,'.env');await symlink(target,file);await assert.rejects(readEnvironment(root,'test'),hasCode('ENV_FILE_INVALID'));await rm(file);
  await link(target,file);await assert.rejects(readEnvironment(root,'test'),hasCode('ENV_FILE_INVALID'));await rm(file);
  await mkdir(file);await assert.rejects(readEnvironment(root,'test'),hasCode('ENV_FILE_INVALID'));await rm(file,{recursive:true});
  await writeFile(file,'A='+ 'x'.repeat(65536));await assert.rejects(readEnvironment(root,'test'),hasCode('ENV_FILE_INVALID'));
  await writeFile(file,Buffer.from([65,61,255]));await assert.rejects(readEnvironment(root,'test'),hasCode('ENV_SYNTAX_INVALID'));
});
test('public disclosure is explicit bounded and does not include private or VITE-prefixed values',async t=>{
  const root=await fixture(t), snapshot=await readEnvironment(root,'test');
  const data=resolveEnvironment(snapshot,{PRIVATE:'private',VITE_HIDDEN:'vite',CORMI_PUBLIC_ZERO:'0'},'production');
  assert.deepEqual({...data.publicEnv},{CORMI_PUBLIC_ZERO:'0'});assert.doesNotMatch(JSON.stringify(data.summary),/PRIVATE|VITE_HIDDEN|private|"0"/);
  assert.throws(()=>resolveEnvironment(snapshot,{CORMI_PUBLIC_BIG:'x'.repeat(300000)},'production'),hasCode('ENV_PUBLIC_LIMIT'));
  assert.throws(()=>resolveEnvironment(snapshot,{'CORMI_PUBLIC_BAD-NAME':'hidden'},'production'),hasCode('ENV_PUBLIC_INVALID'));
});
