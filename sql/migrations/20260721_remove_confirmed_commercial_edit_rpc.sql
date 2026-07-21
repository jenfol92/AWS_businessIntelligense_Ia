-- Retira la edición comercial directa de órdenes confirmadas.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.update_confirmed_purchase_order(uuid, jsonb, jsonb)
FROM authenticated, service_role;

DROP FUNCTION IF EXISTS public.update_confirmed_purchase_order(uuid, jsonb, jsonb);

COMMIT;
