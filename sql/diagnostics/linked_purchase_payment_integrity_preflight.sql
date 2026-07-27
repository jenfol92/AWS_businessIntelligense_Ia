-- Solo lectura. Ejecutar en una base de pruebas antes de aplicar
-- 20260722_linked_purchase_payment_batches.sql.

-- Permisos directos: el estado final esperado es false/false/false.
SELECT
  has_table_privilege('authenticated', 'public.finance_supplier_payments', 'SELECT') AS can_select,
  has_table_privilege('authenticated', 'public.finance_supplier_payments', 'INSERT') AS can_insert,
  has_table_privilege('authenticated', 'public.finance_supplier_payments', 'UPDATE') AS can_update,
  has_table_privilege('authenticated', 'public.finance_supplier_payments', 'DELETE') AS can_delete;

-- La huella es obligatoria para distinguir reintentos identicos de reutilizacion
-- conflictiva de la misma idempotency_key.
SELECT
  c.column_name,
  c.is_nullable,
  c.data_type
FROM information_schema.columns c
WHERE c.table_schema = 'public'
  AND c.table_name = 'finance_purchase_payment_batches'
  AND c.column_name = 'payload_fingerprint';

-- Todas las CHECK que mencionan status. Antes de migrar solo se admite como
-- reemplazable finance_supplier_payments_status_check.
SELECT c.conname, pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conrelid = 'public.finance_supplier_payments'::regclass
  AND c.contype = 'c'
  AND pg_get_constraintdef(c.oid) ~* '\mstatus\M'
ORDER BY c.conname;

-- Estado posterior: una unica regla efectiva compatible con los cuatro estados.
SELECT count(*) AS compatible_status_checks
FROM pg_constraint c
WHERE c.conrelid = 'public.finance_supplier_payments'::regclass
  AND c.contype = 'c'
  AND pg_get_constraintdef(c.oid) ~* '\mstatus\M'
  AND pg_get_constraintdef(c.oid) LIKE '%pendiente%'
  AND pg_get_constraintdef(c.oid) LIKE '%parcial%'
  AND pg_get_constraintdef(c.oid) LIKE '%pagado%'
  AND pg_get_constraintdef(c.oid) LIKE '%vencido%';

-- Firmas, modo de seguridad, owner y permisos. Cualquier fila adicional es un
-- overload que debe revisarse; este diagnostico no borra nada.
SELECT
  p.oid::regprocedure AS signature,
  pg_get_function_arguments(p.oid) AS arguments,
  owner_role.rolname AS owner,
  CASE WHEN p.prosecdef THEN 'definer' ELSE 'invoker' END AS security_mode,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
JOIN pg_roles owner_role ON owner_role.oid = p.proowner
WHERE n.nspname = 'public'
  AND p.proname IN (
    'sync_supplier_payment_plan',
    'mark_and_finance_supplier_payment',
    'create_and_apply_purchase_payment_batch',
    'get_purchase_payment_candidates',
    'get_purchase_payment_batch_detail',
    'update_confirmed_purchase_order_operations'
  )
ORDER BY p.proname, p.oid::regprocedure::text;

-- Debe devolver cero filas: ninguna funcion invoker puede hacer DML sobre
-- finance_supplier_payments despues de revocar escrituras directas.
SELECT
  p.oid::regprocedure AS unsafe_invoker_signature,
  pg_get_functiondef(p.oid) AS definition
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind = 'f'
  AND NOT p.prosecdef
  AND pg_get_functiondef(p.oid) ~*
    '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+public[.]finance_supplier_payments';

-- Obligaciones manuales quedan trazables en planificacion general, pero fuera
-- de candidatos de settlement nuevo.
SELECT id, orden_id, payment_type, amount_original, original_currency, due_date, status
FROM public.finance_supplier_payments
WHERE payment_source_type = 'manual'
ORDER BY due_date NULLS LAST, orden_id, payment_type;
