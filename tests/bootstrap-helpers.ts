import assert from 'node:assert/strict';
import { watch, existsSync, type FSWatcher } from 'node:fs';
import { dirname } from 'node:path';
import { runCormi, type LaunchOptions, type LauncherEvent } from 'cormijs/launcher';
import { createBootstrap, readEnvironmentFiles, type LaunchPolicy, type LaunchEnvironment, type LaunchReload } from 'cormijs/bootstrap';
import type { Plugin } from '@cormijs/core';
import { until, httpText } from '../scripts/reliability/resources.js';
export { until, httpText, createBootstrap, readEnvironmentFiles };

export const servePolicy: Plugin.Object<void> = {name:'test:serve-policy',apply(ctx){
  ctx.provide('launchPolicy',{resolve: request => ({configurationCommand:request.configurationCommand??request.command,
    mode:request.mode??'staging',nodeEnv:'development',watch:request.watch??true})} satisfies LaunchPolicy);
}};
export function fileEnvironment(file: string): Plugin.Object<void> {
  return {name:'test:file-environment',apply(ctx){ctx.provide('launchEnvironment',{
    files:()=>[file],load:({root,plan,files})=>readEnvironmentFiles(root,plan.mode,files),
  } satisfies LaunchEnvironment);}};
}
export const serveConfig = `import {createServer} from 'node:http';import settings from './settings';
export default ({command,mode,env})=>({plugins:[{id:'http',plugin:{inject:['commands'],apply(ctx){
ctx.effect(()=>ctx.commands.register('serve',async()=>{
 const server=createServer((_req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({version:settings,command,mode,node:env.NODE_ENV,value:env.CORMI_PUBLIC_BOOT,pid:process.pid}))});
 await new Promise((r,j)=>{server.once('error',j);server.listen(0,'127.0.0.1',r)});
 let closing;const close=()=>closing??=new Promise((r,j)=>{server.close(e=>e?j(e):r());server.closeAllConnections()});ctx.effect(()=>close);
 return {kind:'server',handle:{url:'http://127.0.0.1:'+server.address().port,close}};
}));}}}]});`;
export function carrier(options: LaunchOptions) {
  const abort = new AbortController(), events: LauncherEvent[]=[];
  let settled = false, error: unknown;
  const done = runCormi({...options,signal:abort.signal,onEvent:event=>{events.push(event);options.onEvent?.(event);}});
  void done.then(()=>{settled=true;},reason=>{settled=true;error=reason;});
  async function event(check:(event:LauncherEvent)=>boolean,from=0,ms=4000) {
    let found:LauncherEvent|undefined;
    await until(()=>{found=events.slice(from).find(check);if(!found&&settled)throw error??new Error('Ended: '+JSON.stringify(events));return !!found;},'carrier event '+JSON.stringify(events),ms);
    return found!;
  }
  return {events,done,abort,event,get settled(){return settled;},async stop(){abort.abort();return done;}};
}
/** Test-only real filesystem provider. Wake completion includes watcher/timer teardown. */
export function filesystemReload() {
  const state={waits:0,events:0,watchers:0,closed:0,seen:new Set<string>()};
  const plugin:Plugin.Object<void>={name:'test:filesystem-reload',apply(ctx){
    const lifetime=new AbortController(),pending=new Set<Promise<void>>();
    ctx.provide('launchReload',{wait(request){
      state.waits++;for(const file of request.files)state.seen.add(file);
      const signal=AbortSignal.any([lifetime.signal,request.signal]);
      const task=new Promise<void>((resolve,reject)=>{
        const watchers:FSWatcher[]=[];let finished=false,timer:NodeJS.Timeout|undefined;
        const finish=(error?:unknown)=>{
          if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',cancel);
          void Promise.all(watchers.map(watcher=>new Promise<void>(done=>{watcher.once('close',()=>{state.watchers--;state.closed++;done();});watcher.close();})))
            .then(()=>error?reject(error):resolve(),reject);
        };
        const cancel=()=>finish(signal.reason??new Error('Cancelled'));
        if(signal.aborted){finish(signal.reason);return;}
        signal.addEventListener('abort',cancel,{once:true});
        try {
          const directories=new Set(request.files.map(file=>{let path=dirname(file);while(!existsSync(path)&&dirname(path)!==path)path=dirname(path);return path;}));
          for(const directory of directories){const watcher=watch(directory,()=>{state.events++;finish();});watchers.push(watcher);state.watchers++;watcher.on('error',finish);}
          timer=setTimeout(()=>finish(),request.intervalMs);
        }catch(error){finish(error);}
      });
      pending.add(task);void task.then(()=>pending.delete(task),()=>pending.delete(task));return task;
    }} satisfies LaunchReload);
    ctx.effect(()=>async()=>{lifetime.abort();await Promise.allSettled([...pending]);assert.equal(state.watchers,0);});
  }};
  return {plugin,state};
}
