/**
 * Types for OrderDraft — in-memory projection of a future ordenes_compra row.
 *
 * Field names mirror the DB schema as closely as possible so that Fase 1
 * (createOrden) can do a straight field mapping when inserting into Supabase.
 *
 * DB reference: sql/tables/ordenes_compra.sql + migrations:
 *   - ordenes_compra_payment_etd_eta.sql
 *   - ordenes_proforma_firmada.sql
 */

import type { DraftOrderContainerEstimate } from "./index";

// ─────────────────────────────────────────────────────────────────────────────
// Supplier payment defaults (sourced from proveedores table)
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_DEPOSIT_PERCENTAGE = 30;
export const DEFAULT_BALANCE_DAYS_BEFORE_ARRIVAL = 10;
export const DEFAULT_BALANCE_CONDITIONS_TEXT =
  "The balance will be paid 10 days before the vessel arrives at the port";

/**
 * Payment terms from the supplier master record (proveedores).
 * All fields are optional — defaults are applied when absent.
 *
 * DB columns: proveedores.deposito_porcentaje,
 *             proveedores.balance_dias_antes_eta,
 *             proveedores.balance_condiciones_texto
 */
export type SupplierPaymentDefaults = {
  depositPercentage?: number | null;
  balanceDaysBeforeArrival?: number | null;
  balanceConditionsText?: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Payment schedule
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mirrors ordenes_compra payment fields:
 *   deposito_porcentaje, balance_dias_antes_eta,
 *   balance_condiciones_texto, fecha_pago_balance
 */
export type PaymentSchedule = {
  /**
   * Percentage of total cost paid as deposit when order is placed.
   * DB: ordenes_compra.deposito_porcentaje
   */
  depositPercentage: number;

  /** EUR amount of the deposit (totalPurchaseCapitalRequired × depositPercentage / 100). */
  depositAmount: number;

  /**
   * Intended payment date for the deposit.
   * Equals the group's earliestOrderDate (or today if not set).
   * Maps to DB: fecha_orden (not stored separately for deposit).
   */
  depositDate: string | null;

  /** Complement percentage paid before vessel arrives. */
  balancePercentage: number;

  /** EUR amount of the balance. */
  balanceAmount: number;

  /**
   * Target payment date for the balance.
   * Formula: estimatedArrivalDate − balanceDaysBeforeArrival.
   * DB: ordenes_compra.fecha_pago_balance (computed by trigger on insert).
   */
  balanceDate: string | null;

  /**
   * Days before estimated arrival when balance is due.
   * DB: ordenes_compra.balance_dias_antes_eta
   */
  balanceDaysBeforeArrival: number;

  /**
   * Human-readable payment condition text shown on the proforma.
   * DB: ordenes_compra.balance_condiciones_texto
   */
  balanceConditionsText: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Order draft item — mirrors orden_items row
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Single line item in the draft order.
 * Maps 1-to-1 with a future orden_items row.
 *
 * DB reference: sql/tables/ordenes_compra.sql (orden_items table)
 */
export type OrderDraftItem = {
  /** DB: orden_items.producto_id */
  productId: string;

  /** For display / debugging — not stored in orden_items. */
  sku: string;

  /** For display — not stored in orden_items. */
  productName: string | undefined;

  /** DB: orden_items.proveedor_id (same as order header for single-supplier orders) */
  supplierId: string | null;

  /** DB: orden_items.cantidad */
  quantity: number;

  /**
   * CBM per single unit. Derived: line.cbmTotal / line.recommendedOrderUnits.
   * DB: orden_items.cbm_unitario
   */
  cbmPerUnit: number | null;

  /**
   * Total CBM for this line = quantity × cbmPerUnit.
   * DB: orden_items.cbm_total (GENERATED ALWAYS AS stored column).
   */
  cbmTotal: number | null;

  /**
   * Weight of the full line in kg. Informational — not in orden_items schema yet.
   * Kept here for container planning before DB insertion.
   */
  weightKgTotal: number | null;

  /**
   * Unit purchase cost in EUR.
   * DB: orden_items.coste_unitario_eur
   */
  unitCostEur: number | null;

  /**
   * Total line cost = quantity × unitCostEur.
   * Redundant but useful for display before DB insert.
   */
  lineCostEur: number | null;

  // ── Timing (from plan line — for reference only, not in orden_items) ────────

  /** Planner's recommended order date for this product. */
  recommendedOrderDate: string | null;

  /** Planner's estimated arrival date = recommendedOrderDate + leadTime. */
  estimatedArrivalDate: string | null;

  // ── Plan traceability ─────────────────────────────────────────────────────

  orderTimingStatus: "ON_TIME" | "DUE_NOW" | "OVERDUE";
  daysLate: number;
  moqApplied: boolean;
  cartonMultipleApplied: boolean;
  consolidationEligible: boolean;
};

// ─────────────────────────────────────────────────────────────────────────────
// Validation warnings
// ─────────────────────────────────────────────────────────────────────────────

export type OrderDraftWarningCode =
  | "NO_SUPPLIER"
  | "NO_ORIGIN_PORT"
  | "MISSING_CBM_DATA"
  | "MISSING_COST_DATA"
  | "OVERDUE_LINES"
  | "BALANCE_DATE_BEFORE_TODAY"
  | "DEPOSIT_DATE_BEFORE_TODAY"
  | "BALANCE_DATE_BEFORE_DEPOSIT_DATE";

export type OrderDraftWarning = {
  code: OrderDraftWarningCode;
  message: string;
  /** Product IDs affected, when the warning is line-specific. */
  affectedProductIds?: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// OrderDraft — main type
// ─────────────────────────────────────────────────────────────────────────────

/**
 * In-memory representation of a future ordenes_compra row + its orden_items.
 *
 * Field naming follows DB column names where possible:
 *   camelCase(db_column_name)
 *
 * Fields that will be auto-generated by the DB on INSERT are null here:
 *   - numeroOrden (trigger gen_numero_orden)
 *   - fechaConfirmacion, etaReal, numeroPedidoAgente (set on confirmation)
 *   - proformaFirmadaUrl, proformaFirmadaAt (set on proforma upload)
 *   - tipoCambioUsdEur (set on confirmation)
 *   - fechaPagoBalance (trigger calcular_fecha_pago_balance on INSERT)
 */
export type OrderDraft = {
  // ── Status ────────────────────────────────────────────────────────────────

  /** DB: ordenes_compra.estado = 'borrador' */
  estado: "borrador";

  /** DB: ordenes_compra.tipo_envio */
  tipoEnvio?: "propio" | "amazon_agl";

  // ── Supplier / agent ──────────────────────────────────────────────────────

  /** DB: ordenes_compra.created_by (will be set from session on insert) */
  supplierId: string | null;
  supplierName: string | null;
  agentId: string | null;
  agentName: string | null;

  // ── Ports ─────────────────────────────────────────────────────────────────

  /**
   * Origin port (China side).
   * DB: ordenes_compra.fob_puerto
   */
  fobPuerto: string | null;

  /**
   * Destination port (Spain/EU side). Unknown at draft stage.
   * DB: ordenes_compra.destino
   */
  destino: string | null;

  // ── Dates ─────────────────────────────────────────────────────────────────

  /**
   * Date the draft is created (= today).
   * DB: ordenes_compra.fecha_orden
   */
  fechaOrden: string;

  /**
   * Planner's recommended order date (earliest among all lines in the group).
   * Used to set the deposit date and cross-check urgency.
   * Not a direct DB column — informs fecha_orden on confirmation.
   */
  recommendedOrderDate: string | null;

  /**
   * Estimated departure date from origin port.
   * DB: ordenes_compra.etd (Estimated Time of Departure)
   * Null at draft stage — set when booking is confirmed.
   */
  etd: string | null;

  /**
   * Estimated arrival date = recommendedOrderDate + totalLeadTimeDays.
   * Earliest estimatedArrivalDate across all lines.
   * DB: ordenes_compra.eta
   */
  eta: string | null;

  /**
   * Lead time: production days (derived from earliest line's delta or supplier defaults).
   * DB: ordenes_compra.lead_time_produccion
   * Null until confirmed with supplier.
   */
  leadTimeProduccion: number | null;

  /**
   * Lead time: sea transit days.
   * DB: ordenes_compra.lead_time_transito
   * Null until confirmed with supplier.
   */
  leadTimeTransito: number | null;

  // ── Volumes ───────────────────────────────────────────────────────────────

  /** DB: ordenes_compra.cbm_total (trigger-computed on DB; here calculated) */
  cbmTotal: number;

  /** DB: ordenes_compra.cbm_limite (default 65 = 40HQ usable m³) */
  cbmLimite: number;

  // ── Costs ─────────────────────────────────────────────────────────────────

  /**
   * Total purchase cost in EUR.
   * DB: ordenes_compra.coste_total_eur
   */
  costeTotalEur: number;

  /**
   * Total purchase cost in USD (unknown at draft stage — filled on confirmation).
   * DB: ordenes_compra.coste_total_usd
   */
  costeTotalUsd: number | null;

  /**
   * Exchange rate USD/EUR (set when confirming the order).
   * DB: ordenes_compra.tipo_cambio_usd_eur
   */
  tipoCambioUsdEur: number | null;

  // ── Additional aggregates (not in ordenes_compra, for draft UI) ───────────

  totalUnits: number;
  totalWeightKg: number;

  // ── Payment ───────────────────────────────────────────────────────────────

  /**
   * Full payment schedule with deposit and balance amounts/dates.
   * Individual fields map to:
   *   ordenes_compra.deposito_porcentaje
   *   ordenes_compra.balance_dias_antes_eta
   *   ordenes_compra.balance_condiciones_texto
   *   ordenes_compra.fecha_pago_balance (trigger-computed on DB)
   */
  paymentSchedule: PaymentSchedule;

  /**
   * Shortcut: deposit EUR amount. Redundant with paymentSchedule.depositAmount
   * but surfaced at the top level for quick display.
   */
  estimatedDepositAmount: number;

  /**
   * Shortcut: balance EUR amount.
   */
  estimatedBalanceAmount: number;

  // ── Container estimate ────────────────────────────────────────────────────

  /** Carried over from DraftOrderGroup — unchanged. */
  containerEstimate: DraftOrderContainerEstimate;

  // ── Line items ────────────────────────────────────────────────────────────

  /** One item per AnnualPurchasePlanLine in the source group. */
  items: OrderDraftItem[];

  // ── Validation ────────────────────────────────────────────────────────────

  /**
   * Non-blocking warnings that the user must review before confirming.
   * An empty array means the draft is ready to submit.
   */
  warnings: OrderDraftWarning[];

  /**
   * True when warnings contains no entries that would prevent DB insertion.
   * Currently: NO_SUPPLIER or MISSING_CBM_DATA block insertion.
   */
  isReadyToSubmit: boolean;

  // ── Traceability ──────────────────────────────────────────────────────────

  /**
   * The DraftOrderGroup.groupKey this draft was built from.
   * Links back to the plan for audit / re-generation.
   */
  sourcePlanGroupKey: string;
};
