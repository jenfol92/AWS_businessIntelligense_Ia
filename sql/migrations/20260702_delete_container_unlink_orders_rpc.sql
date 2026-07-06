CREATE OR REPLACE FUNCTION public.delete_container_unlink_orders(
  p_contenedor_id uuid,
  p_unlink_assigned_orders boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_container record;
  v_assigned_orders jsonb;
  v_assigned_count integer;
BEGIN
  SELECT id, estado, estado_stock
  INTO v_container
  FROM public.contenedores
  WHERE id = p_contenedor_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 404,
      'message', 'Contenedor no encontrado.'
    );
  END IF;

  IF lower(coalesce(v_container.estado_stock, '')) = 'disponible_stock'
     OR lower(coalesce(v_container.estado, '')) IN ('disponible_stock', 'facturado') THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 409,
      'message', 'No se puede eliminar un contenedor con stock aplicado o disponible.'
    );
  END IF;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'numero_orden', o.numero_orden,
        'numero_pedido_agente', o.numero_pedido_agente
      )
      ORDER BY o.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_assigned_orders
  FROM public.contenedor_ordenes co
  JOIN public.ordenes_compra o ON o.id = co.orden_id
  WHERE co.contenedor_id = p_contenedor_id;

  v_assigned_count := jsonb_array_length(v_assigned_orders);

  IF v_assigned_count > 0 AND p_unlink_assigned_orders IS DISTINCT FROM true THEN
    RETURN jsonb_build_object(
      'ok', false,
      'status', 409,
      'requiresConfirmation', true,
      'assignedOrders', v_assigned_orders,
      'message', 'El contenedor tiene ordenes asignadas. Confirma si quieres desvincularlas y eliminar solo el contenedor.'
    );
  END IF;

  UPDATE public.orden_logistics_assignments
  SET status = 'inactive'
  WHERE assignment_type = 'contenedor_propio'
    AND contenedor_id = p_contenedor_id
    AND status = 'active';

  DELETE FROM public.contenedor_ordenes
  WHERE contenedor_id = p_contenedor_id;

  DELETE FROM public.contenedores
  WHERE id = p_contenedor_id;

  RETURN jsonb_build_object(
    'ok', true,
    'deletedContainerId', p_contenedor_id,
    'unlinkedOrders', v_assigned_count
  );
END;
$$;
