/**
 * Módulo      : containers
 * Archivo     : types/updateContainer.types.ts
 * Responsabilidad: Contrato de entrada para actualizar un contenedor (PUT /api/containers/[id]).
 * No debe     : contener lógica de negocio ni acceso a datos.
 */

/** Campos actualizables del contenedor vía PUT. */
export interface UpdateContainerBody {
  identificador_embarque?: string;
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
  costo_transito_total_eur?: number | null;
  /**
   * Si se envía appendNota, se añade al final de las notas existentes sin pisar el historial.
   * Formato esperado: "[YYYY-MM-DD HH:mm] Texto del apunte"
   */
  appendNota?: string | null;
}
