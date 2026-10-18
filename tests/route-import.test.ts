import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { resolveRouteComponent } from '@cormijs/runtime';

test('generated route import adapter preserves successful component identity without calling the component',async()=>{
  let called=0;const component=()=>{called++;return null;};
  assert.equal(await resolveRouteComponent(async()=>component),component);assert.equal(called,0);
});
test('generated route import adapter rethrows the exact rejected value at render rather than leaving a rejected lazy promise',async()=>{
  for(const value of [new TypeError('failed chunk'),new Error('module evaluation'), 'string failure',null]) {
    const component=await resolveRouteComponent(async()=>{throw value;});
    assert.equal(typeof component,'function');
    const element=createElement(component);
    assert.throws(()=>{try{(element.type as ()=>never)()}catch(error){assert.equal(error,value);throw new Error('observed exact rejection')}},/observed exact rejection/);
  }
});
