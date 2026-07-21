-- Retira la edición comercial directa de órdenes confirmadas.
-- El REVOKE se omite si la función no existe en el entorno (evita fallo en
-- bases que aún no aplicaron 20260720_confirmed_order_edit_reopen_rpcs.sql).

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'update_confirmed_purchase_order'
      AND pg_get_function_identity_arguments(p.oid) = 'uuid, jsonb, jsonb'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.update_confirmed_purchase_order(uuid, jsonb, jsonb)
    FROM authenticated, service_role;
  END IF;
END;
$$;

DROP FUNCTION IF EXISTS public.update_confirmed_purchase_order(uuid, jsonb, jsonb);

COMMIT;
