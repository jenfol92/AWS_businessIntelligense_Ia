/**
 * Tipos del módulo de proveedores (tabla `proveedores`).
 * Columnas verificadas en Supabase (2026-06).
 */

/** Fila cruda de la tabla proveedores. */
export type SupplierRow = {
  id: string;
  nombre: string;
  pais: string | null;
  ciudad: string | null;
  provincia: string | null;
  puerto_preferido: string | null;
  puerto_preferido_id: string | null;
  latitud: number | null;
  longitud: number | null;
  dias_produccion_estandar: number | null;
  dias_transito_estandar: number | null;
  deposito_porcentaje: number | null;
  balance_dias_antes_eta: number | null;
  balance_condiciones_texto: string | null;
  agente_id: string | null;
  created_at: string | null;
};

/** Proveedor enriquecido para listados y detalle (sin UUID visibles en UI). */
export type SupplierEnriched = SupplierRow & {
  puerto_preferido_nombre: string | null;
  agente_contacto: string | null;
  incompleto: boolean;
  incompleto_motivos: string[];
};

/** Filtros admitidos en GET /api/suppliers. */
export type SupplierListFilters = {
  q?: string;
  pais?: string;
  /** UUID de puertos_china o texto parcial del nombre. */
  puerto?: string;
  /** UUID de agentes_compra. */
  agente?: string;
  /** complete | incomplete | all */
  completitud?: string;
};

/** Payload de creación / actualización. */
export type SupplierInput = {
  nombre: string;
  pais?: string | null;
  ciudad?: string | null;
  provincia?: string | null;
  puerto_preferido_id?: string | null;
  /** Nombre legible del puerto (compatibilidad legacy). */
  puerto_preferido?: string | null;
  latitud?: number | null;
  longitud?: number | null;
  dias_produccion_estandar?: number | null;
  dias_transito_estandar?: number | null;
  deposito_porcentaje?: number | null;
  balance_dias_antes_eta?: number | null;
  balance_condiciones_texto?: string | null;
  agente_id?: string | null;
};

export type SupplierDeleteBlockReason = {
  productos: number;
  orden_items: number;
  producto_costos: number;
};
