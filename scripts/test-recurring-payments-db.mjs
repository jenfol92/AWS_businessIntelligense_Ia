// Isolated PostgreSQL (PGlite), synthetic fixtures only. No environment file or network connection.
// npm install --prefix .codex-work/finance-validation --no-save --package-lock=false @electric-sql/pglite
import { PGlite } from '../.codex-work/finance-validation/node_modules/@electric-sql/pglite/dist/index.js';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const db = new PGlite();
const read = name => readFileSync(new URL(`../sql/migrations/${name}`, import.meta.url),'utf8');
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT NULL::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS $$ SELECT coalesce(nullif(current_setting('test.jwt_role',true),''),'authenticated')::text $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT jsonb_build_object('app_metadata',jsonb_build_object('role',current_setting('test.app_role',true)), 'user_metadata',jsonb_build_object('role','admin')) $$;
    SELECT set_config('test.app_role','admin',false);
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION public.finance_is_finite_numeric(n numeric) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$ SELECT n IS NOT NULL AND n::text NOT IN ('NaN','Infinity','-Infinity') $$;
    CREATE TABLE public.finance_cash_accounts(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text, currency text, balance numeric, updated_at timestamptz DEFAULT now());
    CREATE TABLE public.finance_credit_lines(id uuid PRIMARY KEY);
    CREATE TABLE public.finance_credit_line_movements(id uuid PRIMARY KEY);
    CREATE TABLE public.finance_credit_line_repayment_groups(id uuid PRIMARY KEY);
  `);
  // Use the repository's real cash-movement schema; the remainder defines unrelated credit-line tables.
  await db.exec(read('finance_credit_lines_grouped_repayments_schema.sql').split('create index if not exists idx_finance_cash_movements_account')[0]);
  // A production-specific CHECK and existing rows must survive the extension unchanged.
  await db.exec(`ALTER TABLE finance_cash_movements DROP CONSTRAINT finance_cash_movements_type_check;
    ALTER TABLE finance_cash_movements ADD CONSTRAINT finance_cash_movements_type_check CHECK
      (movement_type IN ('supplier_payment','credit_repayment','income','fee','adjustment','amazon_payment','bank_transfer','refund'));
    INSERT INTO finance_cash_accounts(id,name,currency,balance) VALUES('f1000000-0000-4000-8000-000000000099','Legacy','EUR',100);
    INSERT INTO finance_cash_movements(cash_account_id,movement_type,direction,amount,movement_date)
      SELECT 'f1000000-0000-4000-8000-000000000099'::uuid,t,'in',1,current_date FROM unnest(ARRAY['amazon_payment','bank_transfer','refund']) t;`);
  for (const file of ['20260803_01_unlinked_obligations_schema.sql','20260803_02_unlinked_obligations_rls.sql',
    '20260803_03_unlinked_obligation_planning_rpcs.sql','20260803_04_unlinked_obligation_recurrence_rpcs.sql',
    '20260803_05_unlinked_obligation_read_models.sql','20260803_06_unlinked_obligations_role_authorization.sql',
    '20260909_01_recurring_payments.sql']) {
    if (file === "20260909_01_recurring_payments.sql") await db.exec("ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated");
    try { await db.exec(read(file)); } catch (error) { throw new Error(`${file}: ${error.message}`, { cause: error }); }
  }
  const query = async (sql, params=[]) => (await db.query(sql,params)).rows;
  const scalar = async (sql, params=[]) => Object.values((await query(sql,params))[0])[0];
  const call = (name,payload) => scalar(`SELECT public.${name}($1::jsonb)`,[JSON.stringify(payload)]);
  assert.equal(Number(await scalar("SELECT count(*) FROM finance_cash_movements WHERE movement_type IN ('amazon_payment','bank_transfer','refund')")),3);
  await db.exec("BEGIN; INSERT INTO finance_cash_movements(cash_account_id,movement_type,direction,amount,movement_date) VALUES('f1000000-0000-4000-8000-000000000099','refund','in',1,current_date); ROLLBACK;");
  await assert.rejects(db.exec("INSERT INTO finance_cash_movements(cash_account_id,movement_type,direction,amount,movement_date) VALUES('f1000000-0000-4000-8000-000000000099','unknown_type','in',1,current_date)"),/check constraint/);
  assert.equal(await scalar("SELECT has_table_privilege('anon','finance_payment_types','SELECT')"),false);
  assert.equal(await scalar("SELECT has_table_privilege('authenticated','finance_payment_types','TRUNCATE')"),false);
  assert.equal(await scalar("SELECT has_table_privilege('authenticated','finance_payment_types','INSERT')"),true);
  await db.exec('BEGIN; GRANT SELECT,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN ON finance_cash_accounts,finance_cash_movements TO anon,authenticated; GRANT INSERT,DELETE ON finance_cash_accounts TO anon,authenticated');
  const repair=readFileSync(new URL('../sql/repairs/20260910_finance_table_grants.PROPOSAL.sql',import.meta.url),'utf8');
  await db.exec(repair.replace('BEGIN;','').replace('COMMIT;',''));
  for(const table of ['finance_cash_accounts','finance_cash_movements']) for(const role of ['anon','authenticated']) {
    assert.equal(await scalar('SELECT has_table_privilege($1,$2,$3)',[role,table,'TRUNCATE']),false);
    assert.equal(await scalar('SELECT has_table_privilege($1,$2,$3)',[role,table,'SELECT']),role==='authenticated');
  }
  await db.exec('ROLLBACK');
  const account = await scalar("INSERT INTO finance_cash_accounts(name,currency,balance) VALUES('Cuenta prueba','EUR',10000) RETURNING id");
  const type = await scalar("SELECT id FROM finance_payment_types WHERE category='social_security'");
  const today = await scalar("SELECT (current_timestamp AT TIME ZONE 'Europe/Madrid')::date::text");
  const year = today.slice(0,4);
  const first = `${year}-01-31`;
  const base = { idempotency_key: randomUUID(), payment_type_id: type, concept:'Seguridad Social', amount_eur:1200,
    cash_account_id:account,date:first,frequency:1,end_date:null,action:'pending' };
  const result = await call('finance_create_recurring_payment',base);
  assert.ok(result.template_id);
  const fingerprint = await scalar('SELECT creation_fingerprint FROM finance_unlinked_obligation_templates WHERE id=$1',[result.template_id]);
  assert.match(fingerprint,/^[0-9a-f]{64}$/);
  assert.equal(Number(await scalar("SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name='creation_payload'")),0);
  assert.ok((await call('finance_create_recurring_payment',Object.fromEntries(Object.entries(base).reverse()))).replayed);
  const decimalReplay = JSON.stringify(base).replace('"amount_eur":1200','"amount_eur":1200.00');
  assert.ok((await scalar('SELECT finance_create_recurring_payment($1::jsonb)',[decimalReplay])).replayed);
  const status = (id,paying) => scalar('SELECT finance_recurring_operation_status($1::uuid,$2::boolean)',[id,paying]);
  assert.equal((await status(base.idempotency_key,false)).state,'confirmed');
  assert.equal((await status(randomUUID(),false)).state,'not_found');
  for (const malformed of [null, [], {...base,amount_eur:'abc'}, {...base,cash_account_id:'xx'}, {...base,date:'2026-02-30'}, {...base,frequency:'hola'}]) {
    await assert.rejects(call('finance_create_recurring_payment',malformed),e=>e.code==='22023' && e.message==='INVALID_PAYMENT_PAYLOAD');
  }
  assert.equal(Number(await scalar('SELECT balance FROM finance_cash_accounts WHERE id=$1',[account])),10000);
  const calendar = async () => (await scalar("SELECT finance_recurring_payment_calendar($1::date,$2::date)",[`${year}-01-01`,`${year}-12-31`])).map(row=>({row}));
  let rows=(await calendar()).map(row=>Object.values(row)[0]);
  assert.equal(rows.length,12);
  const bounded = await scalar('SELECT finance_recurring_payment_calendar($1::date,$2::date)',[year+'-09-01',year+'-12-31']);
  assert.equal(bounded.length,5); // Four projections plus the persisted January arrear.
  assert.equal(bounded.find(r=>r.installment_id).date,first);
  assert.equal(bounded.find(r=>r.installment_id).display_date,year+'-09-01');
  assert.ok(bounded.filter(r=>!r.installment_id).every(r=>r.date>=year+'-09-01'));
  await db.exec('BEGIN');
  await db.query("UPDATE finance_unlinked_obligation_templates SET start_date='2022-01-31' WHERE id=$1",[result.template_id]);
  const old = await scalar("SELECT finance_recurring_payment_calendar('2026-09-01','2027-02-28')");
  assert.equal(old.filter(r=>!r.installment_id).length,6);
  assert.ok(old.filter(r=>!r.installment_id).every(r=>r.date>='2026-09-01' && r.date<='2027-02-28'));
  await db.exec('ROLLBACK');
  assert.equal(rows.filter(row=>row.date===first).length,1);
  assert.equal(rows[0].cash_account_id,account);
  assert.ok(rows.some(row=>row.date===`${year}-02-${Number(year)%4===0?'29':'28'}`));
  assert.ok(rows.some(row=>row.date===`${year}-03-31`));
  // Paying one occurrence of an old template must not create the intervening years.
  await db.exec('BEGIN');
  await db.query("UPDATE finance_unlinked_obligation_templates SET start_date='2022-01-31' WHERE id=$1",[result.template_id]);
  const beforeCount=Number(await scalar('SELECT count(*) FROM finance_unlinked_obligations'));
  const selectedDue=year+'-08-31';
  const selected={idempotency_key:randomUUID(),template_id:result.template_id,due_date:selectedDue,amount_eur:100,paid_date:today,cash_account_id:account};
  await call('finance_pay_unlinked_installment',selected);
  assert.equal(Number(await scalar('SELECT count(*) FROM finance_unlinked_obligations')),beforeCount+1);
  await call('finance_pay_unlinked_installment',selected);
  assert.equal(Number(await scalar('SELECT count(*) FROM finance_unlinked_obligations')),beforeCount+1);
  assert.equal(Number(await scalar('SELECT balance FROM finance_cash_accounts WHERE id=$1',[account])),9900);
  await db.exec('ROLLBACK');
  // Invalid anchor/frequency/end dates cannot create debt or move cash.
  for (const due of [year+'-08-30','2021-12-31']) {
    await assert.rejects(call('finance_pay_unlinked_installment',{idempotency_key:randomUUID(),template_id:result.template_id,due_date:due,amount_eur:100,paid_date:today,cash_account_id:account}),/INVALID_DATE_RANGE/);
  }
  assert.ok((await call('finance_create_recurring_payment',base)).replayed);
  assert.equal((await calendar()).length,12);
  await assert.rejects(call('finance_create_recurring_payment',{...base,amount_eur:1500}),/IDEMPOTENCY_CONFLICT/);
  const installment = rows.find(row=>row.date===first).installment_id;
  const payment = { idempotency_key:randomUUID(),installment_id:installment,amount_eur:400,paid_date:today,cash_account_id:account };
  await call('finance_pay_unlinked_installment',payment); // Simulate a committed payment whose response was lost.
  assert.equal((await status(payment.idempotency_key,true)).state,'confirmed');
  await call('finance_pay_unlinked_installment',payment);
  assert.match(await scalar('SELECT payload_fingerprint FROM finance_unlinked_obligation_payments WHERE idempotency_key=$1',[payment.idempotency_key]),/^[0-9a-f]{64}$/);
  for (const malformed of [{...payment,amount_eur:'abc'}, {...payment,installment_id:'xx'}, {...payment,paid_date:'2026-02-30'}, {...payment,template_id:randomUUID()}]) {
    await assert.rejects(call('finance_pay_unlinked_installment',malformed),e=>e.code==='22023' && e.message==='INVALID_PAYMENT_PAYLOAD');
  }
  assert.equal(Number(await scalar('SELECT balance FROM finance_cash_accounts WHERE id=$1',[account])),9600);
  assert.equal(Number(await scalar("SELECT count(*) FROM finance_cash_movements WHERE movement_type='unlinked_payment'")),1);
  rows=(await calendar()).map(row=>Object.values(row)[0]);
  assert.equal(rows.find(row=>row.installment_id===installment).amount_eur,800);
  assert.equal(rows.filter(row=>row.status==='pagado').reduce((sum,row)=>sum+row.amount_eur,0),400);
  await assert.rejects(call('finance_pay_unlinked_installment',{...payment,idempotency_key:randomUUID(),amount_eur:801}),/PAYMENT_AMOUNT_CONFLICT/);
  assert.equal(Number(await scalar('SELECT balance FROM finance_cash_accounts WHERE id=$1',[account])),9600);
  const before = Number(await scalar('SELECT count(*) FROM finance_unlinked_obligations'));
  await assert.rejects(call('finance_create_recurring_payment',{...base,idempotency_key:randomUUID(),frequency:0,amount_eur:20000,action:'paid'}),/INSUFFICIENT_CASH_CONFLICT/);
  assert.equal(Number(await scalar('SELECT count(*) FROM finance_unlinked_obligations')),before);
  const paid = await call('finance_create_recurring_payment',{...base,idempotency_key:randomUUID(),frequency:0,amount_eur:100,action:'paid'});
  assert.ok(paid.payment.payment_id);
  assert.equal(Number(await scalar('SELECT balance FROM finance_cash_accounts WHERE id=$1',[account])),9500);
  // A projected occurrence is materialized exactly once before its payment.
  const projected = rows.find(row=>!row.installment_id && row.status!=='pagado' && row.date<=today);
  if(projected){
    await call('finance_pay_unlinked_installment',{idempotency_key:randomUUID(),template_id:projected.template_id,due_date:projected.date,amount_eur:1200,paid_date:today,cash_account_id:account});
    const after=(await calendar()).map(row=>Object.values(row)[0]);
    assert.equal(after.filter(row=>row.template_id===projected.template_id && row.date===projected.date).length,0);
  }
  await db.exec("SELECT set_config('test.app_role','logistics',false)");
  await assert.rejects(call('finance_create_recurring_payment',{...base,idempotency_key:randomUUID()}),/ADMIN_OR_ACCOUNTING_REQUIRED/);
  assert.ok((await calendar()).every(row=>Object.values(row)[0].cash_account_id==null));
  await db.exec("SELECT set_config('test.app_role','admin',false); SET ROLE authenticated;");
  await assert.rejects(db.exec("INSERT INTO finance_payment_types(name,category) VALUES('Forbidden','payroll')"),/row-level security/);
  await db.exec("INSERT INTO finance_payment_types(name) VALUES('Asesoría')");
  await assert.rejects(db.exec("INSERT INTO finance_payment_types(name) VALUES(' asesoría ')"),/duplicate key/);
  await db.exec('RESET ROLE');
  // Run against the real permission functions as the actual gateway database role.
  await db.exec('SET ROLE authenticated');
  for (const role of ['admin','accounting']) {
    await query("SELECT set_config('test.app_role',$1,false)",[role]);
    assert.equal(await scalar('SELECT finance_can_manage_unlinked_obligations()'),true);
    assert.ok((await call('finance_create_recurring_payment',{...base,idempotency_key:randomUUID(),frequency:0})).obligation_id);
    assert.equal((await status(payment.idempotency_key,true)).state,'confirmed');
  }
  for (const role of ['logistics','normal','', 'unknown']) {
    await query("SELECT set_config('test.app_role',$1,false)",[role]);
    assert.equal(await scalar('SELECT finance_can_manage_unlinked_obligations()'),false);
    for (const [rpc,payload] of [['finance_create_recurring_payment',base],['finance_pay_unlinked_installment',payment]])
      await assert.rejects(call(rpc,payload),e=>e.code==='42501');
    await assert.rejects(status(payment.idempotency_key,true),e=>e.code==='42501');
  }
  await db.exec("RESET ROLE; SET ROLE anon; SELECT set_config('test.app_role','admin',false)");
  await assert.rejects(call('finance_create_recurring_payment',base),e=>e.code==='42501');
  await assert.rejects(call('finance_pay_unlinked_installment',payment),e=>e.code==='42501');
  await assert.rejects(status(payment.idempotency_key,true),e=>e.code==='42501');
  await db.exec("RESET ROLE; SET ROLE service_role; SELECT set_config('test.jwt_role','service_role',false)");
  assert.equal((await status(payment.idempotency_key,true)).state,'confirmed');
  await db.exec("RESET ROLE; SELECT set_config('test.jwt_role','authenticated',false)");
  console.log('PASS: hardening (preserved movement types, SHA256, direct RPC casts, operation status, actual authenticated role matrix, forged user metadata ignored), migration, 12 monthly occurrences, month-end anchors, account metadata, idempotent creation/payment, partial totals, overpayment, rollback, immediate debit, projected settlement, permissions and custom types.');
} finally { await db.close(); }
