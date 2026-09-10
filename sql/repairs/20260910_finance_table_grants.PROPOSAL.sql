-- LOCAL PROPOSAL ONLY. Not applied to production.
-- Targeted production catalog read confirmed these grants on 2026-09-10.
-- Requires PostgreSQL with MAINTAIN (present on the inspected production server).
-- Preserve authenticated SELECT, RLS, RPC EXECUTE, owners and service_role.
BEGIN;
SET LOCAL lock_timeout = '5s';
REVOKE TRUNCATE,TRIGGER,REFERENCES,MAINTAIN
  ON public.finance_cash_accounts,public.finance_cash_movements FROM anon,authenticated;
-- No direct-write consumer found; account INSERT/DELETE already have no RLS policy.
-- UPDATE is already absent, so there is no UPDATE grant to revoke.
REVOKE INSERT,DELETE ON public.finance_cash_accounts FROM anon,authenticated;
-- No anonymous ERP consumer found. A public HEAD/GET will become permission denied,
-- rather than an RLS-filtered empty result; authenticated reads remain unchanged.
REVOKE SELECT ON public.finance_cash_accounts,public.finance_cash_movements FROM anon;
-- Fail/rollback if role inheritance or PUBLIC still grants any unexpected capability.
DO $$
DECLARE r text; t text; p text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    FOREACH t IN ARRAY ARRAY['public.finance_cash_accounts','public.finance_cash_movements'] LOOP
      FOREACH p IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','TRIGGER','REFERENCES','MAINTAIN'] LOOP
        IF has_table_privilege(r,t,p) IS DISTINCT FROM (r='authenticated' AND p='SELECT') THEN
          RAISE EXCEPTION 'CASH_PRIVILEGES_REQUIRE_REVIEW: role %, table %, privilege %',r,t,p;
        END IF;
      END LOOP;
    END LOOP;
  END LOOP;
END $$;
COMMIT;
