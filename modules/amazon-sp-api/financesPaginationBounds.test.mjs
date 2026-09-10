import test from 'node:test';
import assert from 'node:assert/strict';
import {paginateFinances} from './financesPagination.mjs';
test('repeated token fails without returning partial rows',async()=>{
 let calls=0;await assert.rejects(paginateFinances(async()=>{calls++;return {rows:[1],token:'repeat'};},p=>p.rows,p=>p.token),/REPEATED_TOKEN/);assert.equal(calls,2);
});
test('unique runaway tokens stop at bounded pages',async()=>{
 let calls=0;await assert.rejects(paginateFinances(async()=>({rows:[1],token:String(++calls)}),p=>p.rows,p=>p.token),/PAGE_LIMIT/);assert.equal(calls,100);
});
test('normal pages preserve all rows',async()=>{
 const rows=await paginateFinances(async token=>token?{rows:[2]}:{rows:[1],token:'next'},p=>p.rows,p=>p.token);assert.deepEqual(rows,[1,2]);
});
