import test from 'node:test';
import assert from 'node:assert/strict';
import {solveLineupModel} from '../src/lineup-solver.js';
const model={optimize:'points',opType:'max',constraints:{salary:{max:3},total:{equal:1}},variables:{a:{points:4,salary:2,total:1},b:{points:5,salary:3,total:1}},binaries:{a:1,b:1}};
test('search work is bounded even when the Workers clock is frozen, without poisoning later builds',()=>{
  const original=Date.now;Date.now=()=>1000;
  try{
    assert.throws(()=>solveLineupModel(model,{maxWork:1}),e=>e.code==='solver_limit'&&e.status===503);
    const result=solveLineupModel(model);
    assert.equal(result.feasible,true);assert.equal(result.b,1);assert.equal(result.result,5);
  }finally{Date.now=original;}
});
