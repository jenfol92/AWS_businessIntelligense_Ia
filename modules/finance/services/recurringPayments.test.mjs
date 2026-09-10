import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'next/server') return next('next/server.js', context);
  if (context.parentURL && !context.parentURL.includes('/node_modules/') && specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier))
    return { shortCircuit: true, url: new URL(`${specifier}.ts`, context.parentURL).href };
  return next(specifier, context);
} });
const { buildMonthlyTotals } = await import('../utils/buildMonthlyTotals.ts');
const { resolvePlannedFx, unvaluedPayments } = await import('../utils/monthlyPaymentSummary.ts');
const { buildRecurringPaymentEvents } = await import('./buildRecurringPaymentEvents.ts');
const { validateRecurringPayment } = await import('./recurringPaymentValidation.ts');
const { accountingDate } = await import('../utils/accountingDate.ts');
const { readPaymentOperation, reservePaymentOperation, clearPaymentOperation, attemptPaymentOperation } = await import('../utils/recurringPaymentOperation.ts');
const { mapUnlinkedApiError } = await import('./unlinkedObligationsApiErrors.ts');
const uuid = 'f1000000-0000-4000-8000-000000000001';
const base = { idempotency_key: uuid, payment_type_id: uuid, cash_account_id: uuid, concept: 'Salarios', amount_eur: 1200, date: '2026-01-31', end_date: null, frequency: 1, action: 'pending' };

test('recurring creation accepts indefinite recurrence and one-off, rejects invalid money and dates', () => {
  assert.equal(validateRecurringPayment(base).end_date, null);
  assert.equal(validateRecurringPayment({ ...base, frequency: 0 }).frequency, 0);
  for (const amount of [0, -1, NaN, Infinity, 0.001]) assert.throws(() => validateRecurringPayment({ ...base, amount_eur: amount }));
  assert.throws(() => validateRecurringPayment({ ...base, date: '2026-02-30' }));
  assert.throws(() => validateRecurringPayment({ ...base, end_date: '2026-01-01' }));
  assert.throws(() => validateRecurringPayment({ ...base, frequency: 2 }));
  assert.throws(() => validateRecurringPayment({ ...base, action: 'paid', date: '2099-01-01' }));
});
test('payment requires exactly one persisted or projected installment and valid account', () => {
  const payment = { idempotency_key: uuid, cash_account_id: uuid, installment_id: uuid, amount_eur: 400, paid_date: '2026-01-31' };
  assert.equal(validateRecurringPayment(payment, true).amount_eur, 400);
  assert.throws(() => validateRecurringPayment({ ...payment, template_id: uuid }, true));
  assert.throws(() => validateRecurringPayment({ ...payment, cash_account_id: '' }, true));
});
test('partial recurring payment contributes outstanding to pending and actual payment to paid exactly once', () => {
  const events = buildRecurringPaymentEvents([
    { id: 'installment', installment_id: uuid, date: '2026-09-30', amount_eur: 800, concept: 'Salarios', status: 'parcial', can_pay: true },
    { id: 'payment', date: '2026-08-31', amount_eur: 400, concept: 'Salarios', status: 'pagado' },
  ]);
  assert.equal(buildMonthlyTotals(events).pendingBreakdown.others, 800);
  assert.equal(buildMonthlyTotals(events).paidBreakdown.others, 400);
  assert.equal(buildMonthlyTotals(events.filter(e => e.month === '2026-09')).paidBreakdown.total, 0);
  assert.equal(buildMonthlyTotals(events.filter(e => e.month === '2026-08')).pendingBreakdown.total, 0);
});
test('monthly breakdown keeps categories and excludes informational/amazon events', () => {
  const event = { type: 'supplier_deposit', status: 'pendiente', plannedAmountEur: 100 };
  const totals = buildMonthlyTotals([event, { ...event, plannedAmountEur: 200 }, { ...event, type: 'supplier_balance', plannedAmountEur: 700 }, { ...event, isInformational: true }, { ...event, type: 'amazon_income' }]);
  assert.equal(totals.pendingBreakdown.deposits, 300);
  assert.equal(totals.pendingBreakdown.balances, 700);
  assert.equal(totals.totalPendingPayments, 1000);
});
test('planned order FX does not override payment reference or mix currencies', () => {
  assert.equal(resolvePlannedFx('USD', null, 1.1, 'USD').rate, 1.1);
  assert.equal(resolvePlannedFx('USD', 1.2, 1.1, 'USD').rate, 1.2);
  assert.equal(resolvePlannedFx('CNY', null, 1.1, 'USD').rate, null);
  assert.equal(resolvePlannedFx('USD', -1, Infinity, 'USD').rate, null);
  assert.equal(resolvePlannedFx('EUR', null, null, null).rate, 1);
  assert.equal(resolvePlannedFx('USD', 1.2, 1.1, 'USD').source, 'payment');
  assert.equal(resolvePlannedFx('USD', null, 1.1, 'USD').source, 'order');
});

test('Madrid date covers midnight, DST and winter without using host timezone', () => {
  assert.equal(accountingDate(new Date('2026-09-09T22:30:00Z')), '2026-09-10');
  assert.equal(accountingDate(new Date('2026-01-31T23:30:00Z')), '2026-02-01');
  assert.equal(accountingDate(new Date('2026-03-28T23:30:00Z')), '2026-03-29');
  assert.equal(accountingDate(new Date('2026-10-25T23:30:00Z')), '2026-10-26');
});

function operationFixture() {
  const values = new Map();
  const storage = { getItem:key=>values.get(key)??null, setItem:(key,value)=>values.set(key,value), removeItem:key=>values.delete(key) };
  const operation = { operationId:uuid, paying:false, body:JSON.stringify(base) };
  return { storage, operation, scope:'project:user' };
}
test('lost commit response survives modal destruction, reserves the same operation, and retries once logically', async () => {
  const { storage, operation, scope } = operationFixture();
  const committed = new Map();
  const send = async request => {
    if (!committed.has(request.operationId)) { committed.set(request.operationId, request.body); throw new Error('lost response after commit'); }
    return { ok:true, json:async()=>({ok:true,data:{obligation_id:uuid}}) };
  };
  reservePaymentOperation(storage,scope,operation);
  assert.equal((await attemptPaymentOperation(storage,scope,operation,false,send)).state,'uncertain');
  // A fresh modal/controller reads durable state; another operation cannot replace it.
  const recovered = readPaymentOperation(storage,scope);
  assert.deepEqual(recovered,operation);
  assert.deepEqual(reservePaymentOperation(storage,scope,{...operation,operationId:'another'}),operation);
  assert.equal((await attemptPaymentOperation(storage,scope,recovered,true,send)).state,'confirmed');
  assert.equal(committed.size,1);
  assert.equal(readPaymentOperation(storage,scope),null);
});
test('an uncertain retry is retained even on rejection; an initial confirmed rollback may be corrected', async () => {
  const { storage, operation, scope } = operationFixture();
  const reject = async()=>({ok:false,json:async()=>({ok:false,definitiveRejection:true,error:'Saldo insuficiente'})});
  reservePaymentOperation(storage,scope,operation);
  assert.equal((await attemptPaymentOperation(storage,scope,operation,true,reject)).state,'uncertain');
  assert.ok(readPaymentOperation(storage,scope));
  assert.equal((await attemptPaymentOperation(storage,scope,operation,false,reject)).state,'rejected');
  assert.equal(readPaymentOperation(storage,scope),null);
});
test('malformed responses, inaccessible storage and different actors never erase uncertain state', async () => {
  const { storage, operation, scope } = operationFixture();
  reservePaymentOperation(storage,scope,operation);
  assert.equal((await attemptPaymentOperation(storage,scope,operation,true,async()=>({ok:true,json:async()=>{throw Error('broken json');}}))).state,'uncertain');
  assert.equal(readPaymentOperation(storage,'other-user'),null);
  assert.throws(()=>clearPaymentOperation(storage,scope,'another'));
  assert.throws(()=>reservePaymentOperation({...storage,setItem:()=>{throw Error('disabled');}},'other',operation));
  assert.ok(readPaymentOperation(storage,scope));
});
test('SQL cast and business errors are controlled without leaking SQL details', () => {
  for(const code of ['22P02','22003','22007','22008','22023']) {
    const result = mapUnlinkedApiError(Object.assign(new Error('private SQL detail'),{code}));
    assert.equal(result.status,422);
    assert.doesNotMatch(result.error,/private|SQL/);
  }
  assert.equal(mapUnlinkedApiError(Object.assign(new Error('INVALID_PAYMENT_PAYLOAD'),{code:'P0001'})).status,422);
  assert.equal(mapUnlinkedApiError(Object.assign(new Error('IDEMPOTENCY_CONFLICT'),{code:'P0001'})).status,409);
});
test('unvalued balance includes remaining original currency instead of pretending zero', () => {
  const event = { type: 'supplier_balance', status: 'parcial', plannedFxPending: true, originalCurrency: 'USD', originalAmount: 1000, pendingAmountOriginal: 600 };
  assert.deepEqual(unvaluedPayments([event, { ...event, originalCurrency: 'CNY', pendingAmountOriginal: 2000 }], 'balances'), { USD: 600, CNY: 2000 });
  assert.deepEqual(unvaluedPayments([{ ...event, status: 'pagado' }]), {});
});

test('persisted arrears retain their real due date but contribute to the first visible month', () => {
  const [event] = buildRecurringPaymentEvents([{id:'arrear',date:'2026-06-15',display_date:'2026-09-01',amount_eur:1200,concept:'Salarios',status:'vencido'}]);
  assert.equal(event.date,'2026-06-15');
  assert.equal(event.month,'2026-09');
  assert.equal(buildMonthlyTotals([event]).pendingBreakdown.others,1200);
});
