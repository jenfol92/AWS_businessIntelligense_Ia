// Synthetic local PostgreSQL only. No environment variables or network.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8');
const scalar = async sql => Object.values((await db.query(sql)).rows[0])[0];
const extractFunction = (sql,name) => {
  const start=sql.toLowerCase().indexOf('create or replace function public.'+name+'(');
  assert.ok(start>=0);
  return sql.slice(start,sql.indexOf('$$;',sql.indexOf('$$',start)+2)+3);
};
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE finance_cash_accounts(id uuid PRIMARY KEY,name text,balance numeric,currency text,
      is_operating_treasury boolean DEFAULT false,updated_at timestamptz DEFAULT now());
    CREATE TABLE finance_cash_movements(id uuid PRIMARY KEY,cash_account_id uuid REFERENCES finance_cash_accounts(id));
    INSERT INTO finance_cash_accounts VALUES('f1000000-0000-4000-8000-000000000001','Synthetic',1000,'EUR',false,now());
    INSERT INTO finance_cash_movements VALUES('f1000000-0000-4000-8000-000000000002','f1000000-0000-4000-8000-000000000001');
    CREATE FUNCTION finance_can_read_treasury() RETURNS boolean LANGUAGE sql AS $$
      SELECT current_setting('test.app_role',true) IN ('admin','accounting','logistics') $$;
    CREATE FUNCTION finance_can_read_unlinked_details() RETURNS boolean LANGUAGE sql AS $$
      SELECT current_setting('test.app_role',true) IN ('admin','accounting') $$;
    ALTER TABLE finance_cash_accounts ENABLE ROW LEVEL SECURITY;
    ALTER TABLE finance_cash_movements ENABLE ROW LEVEL SECURITY;
    CREATE POLICY finance_cash_accounts_select_authenticated ON finance_cash_accounts FOR SELECT TO authenticated USING (finance_can_read_treasury());
    GRANT SELECT,INSERT,DELETE,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN ON finance_cash_accounts TO anon,authenticated;
    GRANT SELECT,TRUNCATE,TRIGGER,REFERENCES,MAINTAIN ON finance_cash_movements TO anon,authenticated;
    GRANT ALL ON finance_cash_accounts,finance_cash_movements TO service_role;
    CREATE TABLE trigger_evidence(id uuid);
    CREATE FUNCTION record_fixture_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      INSERT INTO trigger_evidence VALUES(NEW.id); RETURN NEW; END $$;
    CREATE TRIGGER existing_trigger AFTER UPDATE ON finance_cash_accounts FOR EACH ROW EXECUTE FUNCTION record_fixture_update();`);
  await db.exec(extractFunction(read('sql/migrations/20260806_03_amazon_income_and_operating_account_rpcs.sql'),'finance_set_operating_cash_account'));
  await db.exec('REVOKE ALL ON FUNCTION finance_set_operating_cash_account(uuid,boolean) FROM PUBLIC,anon; GRANT EXECUTE ON FUNCTION finance_set_operating_cash_account(uuid,boolean) TO authenticated');
  await db.exec(read('sql/repairs/20260910_finance_table_grants.PROPOSAL.sql'));
  for (const role of ['admin','accounting','logistics','normal']) {
    await db.exec(`SET ROLE authenticated; SELECT set_config('test.app_role','${role}',false)`);
    assert.equal(Number(await scalar('SELECT count(*) FROM finance_cash_accounts')),role==='normal'?0:1);
    // No movement SELECT policy exists in the inspected production snapshot.
    assert.equal(Number(await scalar('SELECT count(*) FROM finance_cash_movements')),0);
    const command="SELECT finance_set_operating_cash_account('f1000000-0000-4000-8000-000000000001',true)";
    if(['admin','accounting'].includes(role)) await db.exec(command);
    else await assert.rejects(db.exec(command),e=>e.code==='42501');
    for(const sql of ['TRUNCATE finance_cash_movements','DELETE FROM finance_cash_accounts',
      "UPDATE finance_cash_accounts SET balance=0","INSERT INTO finance_cash_accounts(id) VALUES(gen_random_uuid())"]) {
      await assert.rejects(db.exec(sql),e=>e.code==='42501');
    }
    await db.exec('RESET ROLE');
  }
  assert.equal(Number(await scalar('SELECT count(*) FROM trigger_evidence')),2);
  // Existing FK remains enforced after REFERENCES was revoked from browser roles.
  await db.exec('SET ROLE service_role');
  await assert.rejects(db.exec('INSERT INTO finance_cash_movements VALUES(gen_random_uuid(),gen_random_uuid())'),e=>e.code==='23503');
  await db.exec("INSERT INTO finance_cash_movements VALUES(gen_random_uuid(),'f1000000-0000-4000-8000-000000000001'); RESET ROLE; SET ROLE anon");
  for(const table of ['finance_cash_accounts','finance_cash_movements'])
    await assert.rejects(db.exec('SELECT * FROM '+table),e=>e.code==='42501');
  await db.exec('RESET ROLE');
  assert.equal(Number(await scalar('SELECT balance FROM finance_cash_accounts')),1000);
  assert.equal(Number(await scalar('SELECT count(*) FROM finance_cash_movements')),2);
  console.log('PASS: exact repair; authenticated SELECT/RLS; admin/accounting existing SECURITY DEFINER RPC; logistics read only; anon denied; direct DML/TRUNCATE denied; existing trigger/FK and service_role retained. Synthetic database only.');
} finally { await db.close(); }
