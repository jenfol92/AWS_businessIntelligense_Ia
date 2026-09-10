-- Targeted follow-up only: do not repeat the completed unlinked RLS/lock audit.
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '20s';
SELECT current_user,session_user,current_setting('transaction_read_only') AS read_only;
SELECT r.rolname,r.rolcanlogin,r.rolsuper,r.rolbypassrls,r.rolinherit,
  has_schema_privilege(r.oid,'public','USAGE') AS schema_usage,
  has_schema_privilege(r.oid,'public','CREATE') AS schema_create
FROM pg_roles r WHERE r.rolname IN ('anon','authenticated','authenticator','service_role',current_user);
SELECT member.rolname AS member,parent.rolname AS granted_role,m.admin_option
FROM pg_auth_members m JOIN pg_roles member ON member.oid=m.member
JOIN pg_roles parent ON parent.oid=m.roleid
WHERE member.rolname IN ('anon','authenticated','authenticator','service_role');
SELECT r.rolname,c.relname,p.privilege,has_table_privilege(r.oid,c.oid,p.privilege) AS effective
FROM pg_roles r CROSS JOIN pg_class c CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN']) p(privilege)
WHERE r.rolname IN ('anon','authenticated','service_role','authenticator')
AND c.oid IN ('public.finance_cash_accounts'::regclass,'public.finance_cash_movements'::regclass)
ORDER BY r.rolname,c.relname,p.privilege;
SELECT c.relname,pg_get_userbyid(c.relowner) AS owner,c.relacl,a.attname,a.attacl
FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
WHERE c.oid IN ('public.finance_cash_accounts'::regclass,'public.finance_cash_movements'::regclass)
ORDER BY c.relname,a.attnum;
-- Non-finance entrypoints and generic SQL executors: catalog read, never invoke them.
SELECT p.oid::regprocedure AS function,n.nspname,pg_get_userbyid(p.proowner) AS owner,p.prosecdef,
  has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE p.prokind='f' AND n.nspname='public' AND p.proname NOT LIKE 'finance_%'
AND (p.prosrc ~* 'finance_cash_accounts|finance_cash_movements|\mtruncate\M|\mexecute\M');
SELECT t.tgrelid::regclass AS relation,t.tgname,t.tgisinternal,pg_get_triggerdef(t.oid) AS definition,
  p.oid::regprocedure AS function,p.prosecdef,pg_get_userbyid(p.proowner) AS owner
FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid
WHERE t.tgrelid IN ('public.finance_cash_accounts'::regclass,'public.finance_cash_movements'::regclass);
-- Only non-secret PostgREST settings; never dump JWT secrets or entire configurations.
SELECT coalesce(r.rolname,'ALL') AS role,coalesce(d.datname,'ALL') AS database,setting
FROM pg_db_role_setting s LEFT JOIN pg_roles r ON r.oid=s.setrole
LEFT JOIN pg_database d ON d.oid=s.setdatabase CROSS JOIN unnest(s.setconfig) setting
WHERE split_part(setting,'=',1) IN ('pgrst.db_schemas','pgrst.db_anon_role','pgrst.db_pre_request');
ROLLBACK;
