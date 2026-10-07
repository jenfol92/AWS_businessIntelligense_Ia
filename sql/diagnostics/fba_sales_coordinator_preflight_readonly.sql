-- Review-only preflight. Does not apply migrations or call mutating RPCs.
BEGIN TRANSACTION READ ONLY;
SHOW transaction_read_only;

SELECT table_name,column_name,data_type,udt_schema,udt_name,is_nullable,
       column_default,is_identity,is_generated
FROM information_schema.columns
WHERE table_schema='public' AND table_name IN
 ('amazon_marketplaces','paises','amazon_spapi_report_jobs','amazon_report_sync_runs',
  'amazon_sync_jobs','amazon_fba_sales_daily_raw','ventas_diarias')
ORDER BY table_name,ordinal_position;

SELECT c.relname AS table_name,con.conname,pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid
JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
 ('amazon_marketplaces','paises','amazon_spapi_report_jobs','amazon_report_sync_runs',
  'amazon_sync_jobs','amazon_fba_sales_daily_raw','ventas_diarias')
ORDER BY c.relname,con.conname;

SELECT t.typname,e.enumlabel
FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid
WHERE t.oid IN (SELECT a.atttypid FROM pg_attribute a
 WHERE a.attrelid IN ('public.amazon_marketplaces'::regclass,'public.paises'::regclass))
ORDER BY t.typname,e.enumsortorder;

SELECT id,code,name,currency FROM public.paises
WHERE code IN ('BE','NL','IE','AE','SA') ORDER BY code;
SELECT code,count(*) FROM public.paises
WHERE code IN ('BE','NL','IE','AE','SA') GROUP BY code;

-- JSON access does not assume region/language_code columns exist.
SELECT id,code,name,currency,pais_id,
       to_jsonb(m)->'region' AS region,to_jsonb(m)->'language_code' AS language_code
FROM public.amazon_marketplaces m ORDER BY code;

SELECT schemaname,tablename,indexname,indexdef FROM pg_indexes
WHERE schemaname='public' AND tablename IN
 ('amazon_spapi_report_jobs','amazon_fba_sales_daily_raw','ventas_diarias','amazon_sync_jobs');

SELECT p.oid::regprocedure AS signature,pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef AS security_definer,p.proconfig,p.proacl,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN
 ('start_amazon_report_sync_run','sync_ventas_diarias_from_amazon_fba_sales',
  'claim_fba_sales_sync','assert_fba_sales_lease','checkpoint_fba_sales_sync','commit_fba_sales_chunk');

SELECT table_name,grantee,privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND grantee IN ('service_role','anon','authenticated')
 AND table_name IN ('amazon_marketplaces','amazon_spapi_report_jobs','amazon_report_sync_runs',
  'amazon_sync_jobs','amazon_fba_sales_daily_raw','ventas_diarias');
SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,pg_get_userbyid(c.relowner) AS owner
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN
 ('amazon_marketplaces','amazon_spapi_report_jobs','amazon_report_sync_runs',
  'amazon_sync_jobs','amazon_fba_sales_daily_raw','ventas_diarias');
SELECT * FROM pg_policies WHERE schemaname='public' AND tablename IN
 ('amazon_spapi_report_jobs','amazon_report_sync_runs','amazon_fba_sales_daily_raw','ventas_diarias');

ROLLBACK;
