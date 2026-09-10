import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planningRequest } from '../utils/planningRequest.ts';

test('planning request returns persisted data without browser caching', async () => {
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async (_,options)=>{
      assert.equal(options.cache,'no-store');
      return {ok:true,json:async()=>({ok:true,months:[]})};
    };
    assert.deepEqual(await planningRequest('/fixture',{},100),{ok:true,months:[]});
  } finally {globalThis.fetch=original;}
});

for (const bodyHangs of [false,true]) test(`refresh deadline covers ${bodyHangs?'body':'connection'} and never reports success or retries`, async () => {
  const original=globalThis.fetch; let calls=0;let signal;
  try {
    globalThis.fetch=async (_,options)=>{calls++;signal=options.signal;
      if(bodyHangs)return {ok:true,json:()=>new Promise(()=>{})};
      return new Promise(()=>{});
    };
    await assert.rejects(planningRequest('/fixture',{method:'POST'},10),/puede seguir en el servidor/);
    assert.equal(signal.aborted,true);assert.equal(calls,1);
  } finally {globalThis.fetch=original;}
});

test('HTTP and malformed response failures reject instead of announcing a completed refresh',async()=>{
  const original=globalThis.fetch;
  try {
    globalThis.fetch=async()=>({ok:false,json:async()=>({ok:false,error:'Sin permiso'})});
    await assert.rejects(planningRequest('/fixture',{},100),/Sin permiso/);
    globalThis.fetch=async()=>({ok:true,json:async()=>{throw new SyntaxError('truncated');}});
    await assert.rejects(planningRequest('/fixture',{},100),/truncated/);
  }finally{globalThis.fetch=original;}
});

test('screen GET only reads; explicit authorized POST reuses observations-only sync and lease',()=>{
  const read=p=>readFileSync(new URL('../../../'+p,import.meta.url),'utf8');
  const get=read('app/api/finance/planning/route.ts');
  const post=read('app/api/finance/amazon-refresh/route.ts');
  const ui=read('modules/finance/components/FinancialPlanningPage.tsx');
  assert.match(get,/await readAmazonPlanningFreshness\(\)/);
  assert.doesNotMatch(get,/ensureFreshAmazonFinancialPlanning|await syncAmazonFinancialPlanning/);
  assert.ok(post.indexOf('await requireFinanceDetailsAccess()')<post.indexOf('await syncAmazonFinancialPlanning'));
  assert.match(post,/observationsOnly: true/);
  assert.match(post,/result.skipped \? "running" : result.successful \? "succeeded" : "failed"/);
  assert.match(ui,/refreshBusy.current/);
  const handler=ui.slice(ui.indexOf("const handleRefresh"),ui.indexOf("const openSupplierPaymentModal"));
  assert.doesNotMatch(handler,/canManageCreditLineRegularizations|canSync/);
  assert.match(handler,/const sync = await planningRequest/);
  assert.match(ui,/initialPlanningRequest.current \?\? planningRequest/);
  assert.match(ui,/finally \{ refreshBusy.current = false; setRefreshing\(false\); \}/);
});
