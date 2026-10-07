const {loadEnvConfig}=require('@next/env');
loadEnvConfig(process.cwd());
const {Client}=require('pg');
const fs=require('node:fs');
(async()=>{
 const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:12000});
 await c.connect();
 try {
  await c.query('BEGIN READ ONLY');
  await c.query("SET LOCAL statement_timeout='20s'");
  const tables=['amazon_fba_inventory_ledger_daily','amazon_spapi_report_jobs','fba_country_stock_daily','amazon_inbound_shipments'];
  const results={};
  for(const [name,sql,args] of [
   ['columns',`select table_name,column_name,data_type,udt_name,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name=any($1) order by table_name,ordinal_position`,[tables]],
   ['constraints',`select c.relname,conname,pg_get_constraintdef(k.oid) definition from pg_constraint k join pg_class c on c.oid=k.conrelid where c.relnamespace='public'::regnamespace and c.relname=any($1)`,[tables]],
   ['indexes',`select tablename,indexname,indexdef from pg_indexes where schemaname='public' and tablename=any($1)`,[tables]],
   ['policies',`select * from pg_policies where schemaname='public' and tablename=any($1)`,[tables]],
   ['grants',`select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and (table_name=any($1) or table_name like '%fba%ledger%' or table_name like '%fba%product%') order by table_name,grantee,privilege_type`,[tables]],
   ['rls',`select relname,relrowsecurity,relforcerowsecurity from pg_class where relnamespace='public'::regnamespace and relname=any($1)`,[tables]],
   ['functions',`select p.proname,pg_get_function_identity_arguments(p.oid) args,pg_get_functiondef(p.oid) definition,p.proacl from pg_proc p where p.pronamespace='public'::regnamespace and (p.proname ilike '%ledger%' or p.proname ilike '%fbm%snapshot%')`,[]],
   ['views',`select viewname,definition from pg_views where schemaname='public' and viewname in ('v_product_fba_stock_daily','v_latest_fba_inventory_by_product_country','v_latest_fba_inventory_by_product_location')`,[]],
   ['deployment',`select to_regprocedure('public.commit_fba_ledger_publication(uuid,integer,text,text,jsonb)')::text as commit_rpc,
     to_regprocedure('public.read_published_fba_ledger(uuid[])')::text as read_rpc,
     exists(select 1 from information_schema.columns where table_schema='public' and table_name='amazon_fba_inventory_ledger_daily' and column_name='publication_job_id') as publication_column,
     (select count(*) from public.amazon_fba_inventory_ledger_daily) as ledger_rows,
     (select max(snapshot_date) from public.amazon_fba_inventory_ledger_daily) as latest_day,
     (select count(*) from public.amazon_spapi_report_jobs where source='fba_ledger_coordinator_v1') as durable_jobs`,[]],
  ]) results[name]=(await c.query(sql,args)).rows;
  fs.mkdirSync('outputs/ledger-phase2',{recursive:true});
  fs.writeFileSync('outputs/ledger-phase2/remote-ddl.json',JSON.stringify(results,null,2));
  console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([k,v])=>[k,v.length]))));
  console.log(JSON.stringify({deployment:results.deployment[0]}));
  await c.query('ROLLBACK');
  const {createClient}=require('@supabase/supabase-js');
  const sb=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY);
  const projected=await sb.from('amazon_spapi_report_jobs').select('id,state:raw->ledger')
   .eq('source','fba_ledger_coordinator_v1').eq('report_type','GET_LEDGER_SUMMARY_VIEW_DATA')
   .in('status',['PENDING','PROCESSING','RATE_LIMITED'])
   .or(`raw->ledger->>nextAttemptAt.is.null,raw->ledger->>nextAttemptAt.lte.${new Date().toISOString()}`)
   .order('requested_at').limit(1).abortSignal(AbortSignal.timeout(10000));
  if(projected.error)throw projected.error;
  console.log(JSON.stringify({jobProjectionReadOnly:true,rows:projected.data.length}));
 } finally {await c.end();}
})().catch(e=>{console.error(e.code||'PREFLIGHT_FAILED');process.exitCode=1;});
