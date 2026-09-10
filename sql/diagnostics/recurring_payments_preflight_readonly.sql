-- Prepared only. Run against the intended project only after read-only inspection is authorized.
BEGIN TRANSACTION READ ONLY;
SELECT current_database(),current_setting('transaction_read_only') AS transaction_read_only;
SELECT c.conname,pg_get_constraintdef(c.oid) AS definition,c.convalidated,a.attname
FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=ANY(c.conkey)
WHERE c.conrelid='public.finance_cash_movements'::regclass AND c.contype='c' AND a.attname='movement_type';
SELECT movement_type,count(*) FROM public.finance_cash_movements GROUP BY movement_type ORDER BY movement_type;
SELECT p.oid::regprocedure AS function,p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('finance_assert_unlinked_actor','finance_can_manage_unlinked_obligations','finance_app_role');
SELECT c.relname AS tabla,c.relrowsecurity AS rls_enabled,c.relforcerowsecurity AS force_rls
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='public' AND c.relname IN ('finance_cash_accounts','finance_cash_movements',
'finance_unlinked_obligation_templates','finance_unlinked_obligations','finance_unlinked_obligation_installments',
'finance_unlinked_obligation_payments','finance_unlinked_obligation_payment_allocations') ORDER BY c.relname;
SELECT schemaname,tablename,policyname,roles,cmd,qual,with_check FROM pg_policies
WHERE schemaname='public' AND tablename LIKE 'finance_%' ORDER BY tablename,policyname;
SELECT grantee,table_name,privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name LIKE 'finance_%'
AND grantee IN ('anon','authenticated','service_role') ORDER BY table_name,grantee,privilege_type;
-- Deployed definitions, including implicit UPDATE locks and function calls, for lock-order review.
SELECT p.oid::regprocedure AS function,pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND p.prokind='f' AND p.proname LIKE 'finance_%'
ORDER BY p.proname;
ROLLBACK;
