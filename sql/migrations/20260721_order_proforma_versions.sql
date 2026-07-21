-- Versiones no firmadas de proformas generadas manualmente.
-- Las proformas firmadas continúan en ordenes_compra.proforma_firmada_url y nunca se sobrescriben.

BEGIN;

CREATE TABLE IF NOT EXISTS public.order_proforma_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id uuid NOT NULL REFERENCES public.ordenes_compra(id) ON DELETE CASCADE,
  version integer NOT NULL,
  html_content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES auth.users(id),
  UNIQUE (orden_id, version)
);

CREATE INDEX IF NOT EXISTS idx_order_proforma_versions_latest
  ON public.order_proforma_versions (orden_id, version DESC);

ALTER TABLE public.order_proforma_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS order_proforma_versions_authenticated_select
  ON public.order_proforma_versions;
CREATE POLICY order_proforma_versions_authenticated_select
  ON public.order_proforma_versions
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS order_proforma_versions_authenticated_insert
  ON public.order_proforma_versions;
CREATE POLICY order_proforma_versions_authenticated_insert
  ON public.order_proforma_versions
  FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

COMMENT ON TABLE public.order_proforma_versions IS
  'Versiones históricas no firmadas de proformas generadas manualmente.';

COMMIT;
