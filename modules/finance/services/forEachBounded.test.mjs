import test from 'node:test';
import assert from 'node:assert/strict';
import {forEachBounded} from '../utils/forEachBounded.ts';
const tick=()=>new Promise(r=>setImmediate(r));
test('1982 writes run once with at most 8 in flight and are fully awaited',async()=>{
 let active=0,max=0,finished=0;const seen=new Set();
 await forEachBounded(Array.from({length:1982},(_,i)=>i),8,async i=>{active++;max=Math.max(max,active);assert.ok(!seen.has(i));seen.add(i);await tick();active--;finished++;});
 assert.equal(max,8);assert.equal(active,0);assert.equal(finished,1982);assert.equal(seen.size,1982);
});
test('abort stops new writes and drains existing work',async()=>{
 const c=new AbortController();let started=0,finished=0;
 await assert.rejects(forEachBounded(Array.from({length:1982},(_,i)=>i),8,async i=>{started++;await tick();if(i===0)c.abort();await tick();finished++;},c.signal),e=>e.name==='AbortError');
 assert.equal(started,8);assert.equal(finished,8);
});
test('failure does not retry and pending work is drained before rejection',async()=>{
 let started=0,finished=0;
 await assert.rejects(forEachBounded([0,1,2,3,4,5],2,async i=>{started++;await tick();if(i===0)throw Error('failure');await tick();finished++;}),/failure/);
 assert.equal(started,2);assert.equal(finished,1);
});
