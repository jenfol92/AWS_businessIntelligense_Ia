/**
 * Módulo      : orders
 * Archivo     : types/orderPersistence.types.ts
 * Responsabilidad: Contratos de entrada y salida para operaciones de persistencia
 *                  sobre ordenes_compra y orden_items en Supabase.
 *                  Refleja el esquema real de las tablas tras todas las migraciones.
 * No debe     : Contener lógica de negocio ni acceso a datos.
 *
 * Columnas generadas/trigger-managed que NUNCA se incluyen en INSERT:
 *   ordenes_compra : numero_orden, cbm_total*, coste_total_usd*, coste_total_eur*,
 *                    fecha_pago_balance*, created_at, updated_at
 *   orden_items    : cbm_total (GENERATED ALWAYS AS cantidad*cbm_unitario STORED)
 *
 * Referencia de migraciones:
 *   sql/migrations/ordenes_compra_payment_etd_eta.sql  (etd, deposito_*, balance_*, proforma_*)
 *   sql/migrations/ordenes_proforma_firmada.sql        (proforma_firmada_url/at)
 *   sql/migrations/fase2_lotes_coste_medio.sql         (orden_items.lote_producto)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Warnings
// ─────────────────────────────────────────────────────────────────────────────

export type OrderItemCostWarning = {
  producto_id: string;
  code: "missing_effective_unit_cost" | "missing_historical_cost";
};

// ─────────────────────────────────────────────────────────────────────────────
// Row shapes (SELECT *)
// ─────────────────────────────────────────────────────────────────────────────

export type OrdenCompraRow = {
  id: string;
  numero_orden: string | null;
  estado: string;
  tipo_envio: "propio" | "amazon_agl";
  fob_puerto: string | null;
  destino: string | null;
  fecha_orden: string;
  fecha_confirmacion: string | null;
  eta: string | null;
  etd: string | null;
  eta_real: string | null;
  lead_time_produccion: number | null;
  lead_time_transito: number | null;
  numero_pedido_agente: string | null;
  agente_id: string | null;
  agente_contacto?: string | null;
  cbm_total: number;
  cbm_limite: number;
  coste_total_usd: number;
  coste_total_eur: number;
  tipo_cambio_usd_eur: number | null;
  moneda_compra: string | null;
  tipo_cambio_moneda_eur: number | null;
  deposito_porcentaje: number | null;
  balance_dias_antes_eta: number | null;
  balance_condiciones_texto: string | null;
  fecha_pago_balance: string | null;
  proforma_firmada_url: string | null;
  proforma_firmada_at: string | null;
  notas: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
};

export type OrdenItemRow = {
  id: string;
  orden_id: string;
  producto_id: string;
  proveedor_id: string | null;
  cantidad: number;
  cbm_unitario: number;
  cbm_total: number;                    // GENERATED column — readable, never writable
  coste_unitario_usd: number | null;
  coste_unitario_eur: number | null;
  coste_unitario_moneda: number | null;
  lote_producto: string | null;
  notas: string | null;
  created_at: string;
};

/** Ítem de orden enriquecido con nombre/SKU del producto y nombre del proveedor. */
export type OrdenItemWithProducto = OrdenItemRow & {
  productos: { sku: string; nombre: string } | null;
  proveedores: { nombre: string } | null;
};

/** Resultado compuesto de cabecera + líneas para edición/confirmación de una orden. */
export type OrdenWithItems = {
  orden: OrdenCompraRow;
  items: OrdenItemWithProducto[];
};

// ─────────────────────────────────────────────────────────────────────────────
// INSERT inputs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Campos aceptados para un INSERT en ordenes_compra.
 * Solo las columnas que existen tras todas las migraciones.
 * Columnas generadas/trigger-managed están ausentes intencionalmente.
 */
export type InsertOrderHeaderInput = {
  estado: "borrador";
  tipo_envio?: "propio" | "amazon_agl";

  // Ports
  fob_puerto?: string | null;
  destino?: string | null;               // was destino_puerto before migration

  // Dates
  fecha_orden: string;                   // ISO date  'YYYY-MM-DD'
  eta?: string | null;
  etd?: string | null;

  // Lead times (null at draft stage)
  lead_time_produccion?: number | null;
  lead_time_transito?: number | null;

  // Volumes – cbm_total and coste_total_* are trigger-managed; cbm_limite is editable
  cbm_limite?: number | null;

  // Payment (inherited from proveedores or overridden per order)
  deposito_porcentaje?: number | null;
  balance_dias_antes_eta?: number | null;
  balance_condiciones_texto?: string | null;

  // Currency / agent reference
  moneda_compra?: string | null;
  planned_fx_foreign_per_eur?: number | null;
  tipo_cambio_moneda_eur?: number | null;
  tipo_cambio_usd_eur?: number | null;
  numero_pedido_agente?: string | null;

  // Misc
  agente_id?: string | null;
  notas?: string | null;
  created_by?: string | null;
};

/**
 * Campos aceptados para un INSERT en orden_items.
 *
 * NUNCA incluir cbm_total — es GENERATED ALWAYS AS (cantidad * cbm_unitario) STORED.
 * Postgres rechaza cualquier intento de insertar en una columna generada.
 */
export type InsertOrderItemInput = {
  orden_id: string;
  producto_id: string;                  // required FK → productos.id
  proveedor_id?: string | null;         // nullable FK → proveedores.id
  cantidad: number;
  cbm_unitario?: number | null;
  coste_unitario_moneda?: number | null;
  coste_unitario_usd?: number | null;
  coste_unitario_eur?: number | null;
  lote_producto?: string | null;        // added by fase2_lotes_coste_medio migration
  notas?: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Operation result types
// ─────────────────────────────────────────────────────────────────────────────

export type InsertOrderItemsResult = {
  rows: OrdenItemRow[];
  warnings: OrderItemCostWarning[];
};

export type UpdateOrderDraftResult = {
  orden: OrdenCompraRow;
  warnings: OrderItemCostWarning[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Query / update inputs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parámetros de búsqueda para listOrders.
 *
 * @property estado        - Estado a filtrar. "ALL" desactiva el filtro.
 * @property q             - Texto a buscar en numero_orden y numero_pedido_agente (ilike).
 * @property createdFrom   - Fecha minima de created_at.
 * @property createdTo     - Fecha maxima de created_at.
 * @property limit         - Número máximo de filas (default 200, techo 500).
 * @property extraOrderIds - IDs adicionales a incluir (búsqueda por SKU/nombre resuelta en API).
 */
export type ListOrdersInput = {
  estado?: string | null;
  q?: string | null;
  createdFrom?: string | null;
  createdTo?: string | null;
  limit?: number;
  extraOrderIds?: string[];
};

/** Campos actualizables en la cabecera de un borrador. */
export type UpdateOrderDraftInput = {
  tipo_envio?: "propio" | "amazon_agl";
  fob_puerto?: string | null;
  destino?: string | null;
  fecha_orden?: string;
  cbm_limite?: number | null;
  agente_id?: string | null;
  notas?: string | null;
  etd?: string | null;
  eta?: string | null;
  eta_real?: string | null;
  lead_time_produccion?: number | null;
  lead_time_transito?: number | null;
  numero_pedido_agente?: string | null;
  moneda_compra?: string | null;
  tipo_cambio_moneda_eur?: number | null;
  tipo_cambio_usd_eur?: number | null;
  deposito_porcentaje?: number | null;
  balance_dias_antes_eta?: number | null;
  balance_condiciones_texto?: string | null;
};

/** Datos necesarios para confirmar una orden de compra. */
export type ConfirmOrderInput = {
  confirmationDate: string;                 // ISO date 'YYYY-MM-DD'
  eta?: string | null;                      // ISO date; null => cálculo automático
  etd?: string | null;
  eta_real?: string | null;
  lead_time_produccion?: number | null;
  lead_time_transito?: number | null;
  numero_pedido_agente?: string | null;
  agente_id?: string | null;
  moneda_compra?: string | null;
  planned_fx_foreign_per_eur?: number | null;
  deposito_porcentaje?: number;
  balance_dias_antes_eta?: number;
  balance_condiciones_texto?: string;
  /** Costes unitarios a aplicar en las líneas antes de confirmar. */
  items_costes?: Array<{
    item_id: string;
    coste_unitario_moneda?: number | null;
    coste_unitario_usd?: number | null;
    coste_unitario_eur?: number | null;
    lote_producto?: string | null;
  }>;
};
