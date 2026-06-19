/** Payload aceptado al crear un contenedor vinculado a órdenes confirmadas. */
export type CreateContainerFromOrderPayload = {
  identificador_embarque: string;
  tipo_contenedor?: string | null;
  transitario?: string | null;
  puerto_salida?: string | null;
  puerto_llegada?: string | null;
  fecha_salida?: string | null;
  fecha_eta_estimada?: string | null;
  estado?: string;
  estado_logistico?: string | null;
  estado_stock?: string | null;
  estado_costes?: string | null;
  notas?: string | null;
  costo_flete_total_eur?: number | null;
  gastos_llegada_puerto_eur?: number | null;
  orden_ids: string[];
};
