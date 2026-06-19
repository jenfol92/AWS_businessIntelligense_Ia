-- Diagnóstico: estados separados vs legacy en contenedores

SELECT
  c.id,
  c.identificador_embarque,
  c.estado AS estado_legacy,
  c.estado_logistico,
  c.estado_stock,
  c.estado_costes,
  c.tipo_contenedor,
  CASE
    WHEN c.estado_logistico IS NULL
      THEN 'FALTA_ESTADO_LOGISTICO'
    WHEN c.estado_stock IS NULL
      THEN 'FALTA_ESTADO_STOCK'
    WHEN c.estado_costes IS NULL
      THEN 'FALTA_ESTADO_COSTES'
    WHEN c.tipo_contenedor IS NULL OR trim(c.tipo_contenedor) = ''
      THEN 'TIPO_CONTENEDOR_PENDIENTE'
    WHEN c.estado IS NOT NULL
      AND c.estado NOT IN (
        'borrador', 'preparando', 'en_puerto_salida', 'en_transito',
        'en_puerto_destino', 'entregado', 'disponible_stock', 'facturado'
      )
      THEN 'LEGACY_SIN_MAPEAR'
    ELSE 'OK'
  END AS diagnostico
FROM public.contenedores c
ORDER BY c.created_at DESC NULLS LAST;
