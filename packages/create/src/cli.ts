#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { createProject, type Template } from './index.js';

const control = new AbortController(), stop = () => control.abort();
process.on('SIGINT',stop); process.on('SIGTERM',stop);
let json = false;
try {
  const {values,positionals} = parseArgs({allowPositionals:true,strict:true,options:{kit:{type:'string'},template:{type:'string'},name:{type:'string'},json:{type:'boolean'},help:{type:'boolean',short:'h'}}});
  json = !!values.json;
  if (values.help) console.log('create-cormi <directory> --kit <local-kit> [--template react|react-api] [--name name] [--json]\nCreates files only; no installation, Git initialization or network calls.');
  else {
    if (positionals.length !== 1 || !values.kit) throw new Error('Usage: create-cormi <new-directory> --kit <local-kit> [--template react|react-api]. Public registry distribution is not enabled yet.');
    const result = await createProject({directory:positionals[0]!,kit:values.kit,template:values.template as Template|undefined,name:values.name,signal:control.signal});
    console.log(json ? JSON.stringify(result) : `Created cormi application at ${result.directory}\nNext: cd into that directory; pnpm install --ignore-scripts; pnpm dev\nLocal framework tarballs are included; retain .cormi-local when moving the project.`);
  }
} catch (error) {
  console.error(json ? JSON.stringify({error:error instanceof Error ? error.message : String(error),code:(error as {code?:string})?.code??'CREATE_FAILED'}) : error instanceof Error ? error.message : String(error)); process.exitCode=1;
} finally { process.off('SIGINT',stop); process.off('SIGTERM',stop); }
