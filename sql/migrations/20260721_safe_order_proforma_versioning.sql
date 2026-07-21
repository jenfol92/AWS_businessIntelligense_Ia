-- Asignación transaccional de versiones de proforma por orden.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_order_proforma_version(
  p_order_id uuid,
  p_html_content text
)
RETURNS public.order_proforma_versions
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_locked_order_id uuid;
  v_next_version integer;
  v_created public.order_proforma_versions;
BEGIN
  IF nullif(p_html_content, '') IS NULL THEN
    RAISE EXCEPTION 'El contenido de la proforma no puede estar vacío.'
      USING ERRCODE = '22023';
  END IF;

  SELECT id
  INTO v_locked_order_id
  FROM public.ordenes_compra
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Orden no encontrada: %', p_order_id USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(max(opv.version), 0) + 1
  INTO v_next_version
  FROM public.order_proforma_versions opv
  WHERE opv.orden_id = p_order_id;

  INSERT INTO public.order_proforma_versions (
    orden_id,
    version,
    html_content,
    created_by
  )
  VALUES (
    p_order_id,
    v_next_version,
    p_html_content,
    auth.uid()
  )
  RETURNING * INTO v_created;

  RETURN v_created;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_order_proforma_version(uuid, text)
FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_order_proforma_version(uuid, text)
TO authenticated, service_role;

COMMIT;
