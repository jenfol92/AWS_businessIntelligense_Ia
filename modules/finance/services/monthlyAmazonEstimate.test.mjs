import test from 'node:test';
import assert from 'node:assert/strict';
import {monthlyAmazonEstimate} from '../utils/monthlyAmazonEstimate.ts';
test('monthly estimate consolidates marketplaces without inventing a bank date',()=>{
 const row={economic_state:'FUTURE',status:'projected',cycle_start:'2026-09-01',expected_bank_date:null,amount_eur:1200};
 assert.equal(monthlyAmazonEstimate([row,{...row,amount_eur:800},{...row,economic_state:'AVAILABLE',amount_eur:900},{...row,cycle_start:'2026-10-01'}],'2026-09'),2000);
});
test('missing estimate differs from a calculated zero and incomplete totals are not shown as complete',()=>{
 assert.equal(monthlyAmazonEstimate([],'2026-09'),null);
 const row={economic_state:'FUTURE',forecast_date:'2026-09-30',amount_eur:0};
 assert.equal(monthlyAmazonEstimate([row],'2026-09'),0);
 assert.equal(monthlyAmazonEstimate([row,{...row,amount_eur:null}],'2026-09'),null);
});
